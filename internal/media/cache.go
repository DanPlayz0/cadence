// SPDX-License-Identifier: GPL-2.0-or-later
package media

import (
	"context"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"cadence/internal/domain"
	"cadence/internal/library"
)

type job struct {
	done   chan struct{}
	cancel context.CancelFunc
	refs   int
	err    error
	path   string
}
type Cache struct {
	Dir         string
	MaxBytes    int64
	RootContext context.Context
	mu          sync.Mutex
	jobs        map[string]*job
	slots       chan struct{}
}

func New(dir string, maxBytes int64, workers int, ctx context.Context) (*Cache, error) {
	if maxBytes < 1 || workers < 1 || ctx == nil {
		return nil, fmt.Errorf("cache needs a positive size, worker count, and root context")
	}
	if err := os.MkdirAll(dir, 0750); err != nil {
		return nil, err
	}
	c := &Cache{Dir: dir, MaxBytes: maxBytes, RootContext: ctx, jobs: map[string]*job{}, slots: make(chan struct{}, workers)}
	entries, _ := os.ReadDir(dir)
	for _, entry := range entries {
		name := entry.Name()
		if !entry.IsDir() && len(name) == 64+len(".mp3.part") && strings.HasSuffix(name, ".mp3.part") {
			if _, err := hex.DecodeString(name[:64]); err == nil {
				_ = os.Remove(filepath.Join(dir, name))
			}
		}
	}
	c.prune()
	return c, nil
}
func Key(t domain.Track, kbps int) string {
	return library.Hash(t.Path + ":" + strconv.FormatInt(t.Size, 10) + ":" + strconv.FormatInt(t.Modified, 10) + ":" + strconv.Itoa(kbps))
}

// Acquire deduplicates conversion. The last disconnected waiter cancels unfinished FFmpeg work.
func (c *Cache) Acquire(ctx context.Context, t domain.Track, kbps int) (string, func(), error) {
	if err := ctx.Err(); err != nil {
		return "", nil, err
	}
	if kbps != 128 && kbps != 320 {
		return "", nil, fmt.Errorf("unsupported bitrate")
	}
	key := Key(t, kbps)
	dest := filepath.Join(c.Dir, key+".mp3")
	c.mu.Lock()
	j := c.jobs[key]
	if j == nil {
		work, cancel := context.WithCancel(c.RootContext)
		j = &job{done: make(chan struct{}), cancel: cancel, path: dest}
		c.jobs[key] = j
		if f, err := os.Stat(dest); err == nil && f.Size() > 0 {
			close(j.done)
		} else {
			go c.generate(work, key, j, t, kbps)
		}
	}
	j.refs++
	c.mu.Unlock()
	var once sync.Once
	release := func() {
		once.Do(func() {
			c.mu.Lock()
			j.refs--
			if j.refs == 0 {
				select {
				case <-j.done:
					j.cancel()
					delete(c.jobs, key)
				default:
					j.cancel()
				}
			}
			c.mu.Unlock()
			c.prune()
		})
	}
	select {
	case <-ctx.Done():
		release()
		return "", nil, ctx.Err()
	case <-j.done:
		if j.err != nil {
			release()
			return "", nil, j.err
		}
		now := time.Now()
		_ = os.Chtimes(dest, now, now)
		return dest, release, nil
	}
}
func (c *Cache) generate(ctx context.Context, key string, j *job, t domain.Track, kbps int) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	defer func() {
		c.mu.Lock()
		close(j.done)
		if j.refs == 0 {
			delete(c.jobs, key)
		}
		c.mu.Unlock()
		c.prune()
	}()
	select {
	case c.slots <- struct{}{}:
		defer func() { <-c.slots }()
	case <-ctx.Done():
		j.err = ctx.Err()
		return
	}
	tmp := j.path + ".part"
	defer os.Remove(tmp)
	// FFmpeg's output limit also bounds temporary files; reject truncated results below.
	cmd := exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-v", "error", "-i", t.Path, "-map", "0:a:0", "-vn", "-codec:a", "libmp3lame", "-b:a", fmt.Sprintf("%dk", kbps), "-fs", strconv.FormatInt(c.MaxBytes, 10), "-f", "mp3", "-y", tmp)
	if err := cmd.Run(); err != nil {
		j.err = fmt.Errorf("conversion failed: %w", err)
		return
	}
	info, err := os.Stat(tmp)
	if err != nil {
		j.err = err
		return
	}
	if info.Size() >= c.MaxBytes {
		j.err = fmt.Errorf("track exceeds transcoding cache size")
		return
	}
	c.mu.Lock()
	if !c.makeRoomLocked(info.Size()) {
		j.err = fmt.Errorf("transcoding cache is full with active streams")
	} else {
		j.err = os.Rename(tmp, j.path)
	}
	c.mu.Unlock()
}
func (c *Cache) prune() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.makeRoomLocked(0)
}

// Retained files never exceed MaxBytes; active files are not evicted. Temporary
// conversion outputs are separately limited to MaxBytes per worker by FFmpeg.
func (c *Cache) makeRoomLocked(required int64) bool {
	entries, err := os.ReadDir(c.Dir)
	if err != nil {
		return false
	}
	type item struct {
		path, key string
		size      int64
		date      time.Time
	}
	var files []item
	var total int64
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".mp3" {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, item{filepath.Join(c.Dir, entry.Name()), entry.Name()[:len(entry.Name())-4], info.Size(), info.ModTime()})
		total += info.Size()
	}
	sort.Slice(files, func(i, j int) bool { return files[i].date.Before(files[j].date) })
	for _, file := range files {
		if total+required <= c.MaxBytes {
			break
		}
		if _, active := c.jobs[file.key]; active {
			continue
		}
		if os.Remove(file.path) == nil {
			total -= file.size
		}
	}
	return total+required <= c.MaxBytes
}
