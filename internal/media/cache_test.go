// SPDX-License-Identifier: GPL-2.0-or-later
package media

import (
	"cadence/internal/domain"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func TestConversionsAndCancellation(t *testing.T) {
	if _, e := exec.LookPath("ffmpeg"); e != nil {
		t.Skip("ffmpeg missing")
	}
	root := t.TempDir()
	file := filepath.Join(root, "song.flac")
	if b, e := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=duration=1", "-y", file).CombinedOutput(); e != nil {
		t.Fatalf("%v %s", e, b)
	}
	c, e := New(filepath.Join(root, "cache"), 1<<20, 1, context.Background())
	if e != nil {
		t.Fatal(e)
	}
	info, _ := os.Stat(file)
	track := domain.Track{Path: file, Size: info.Size(), Modified: info.ModTime().UnixNano()}
	var wg sync.WaitGroup
	results := make(chan string, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, release, e := c.Acquire(context.Background(), track, 128)
			if e != nil {
				results <- "error: " + e.Error()
				return
			}
			defer release()
			results <- p
		}()
	}
	wg.Wait()
	close(results)
	want := filepath.Join(c.Dir, Key(track, 128)+".mp3")
	for p := range results {
		if p != want {
			t.Fatal(p)
		}
	}
	if info, e := os.Stat(want); e != nil || info.Size() == 0 {
		t.Fatal("missing output")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, release, e := c.Acquire(ctx, track, 320)
	if release != nil {
		release()
	}
	if e == nil {
		t.Fatal("cancelled request succeeded")
	}
	if _, _, e = c.Acquire(context.Background(), track, 42); e == nil {
		t.Fatal("invalid bitrate permitted")
	}
}

func TestBoundedCacheAndStalePartCleanup(t *testing.T) {
	dir := t.TempDir()
	key := strings.Repeat("a", 64)
	os.WriteFile(filepath.Join(dir, key+".mp3.part"), []byte("partial"), 0600)
	os.WriteFile(filepath.Join(dir, key+".mp3"), []byte("123456"), 0600)
	c, e := New(dir, 5, 1, context.Background())
	if e != nil {
		t.Fatal(e)
	}
	if _, e = os.Stat(filepath.Join(dir, key+".mp3.part")); !os.IsNotExist(e) {
		t.Fatal("stale partial remained")
	}
	if _, e = os.Stat(filepath.Join(dir, key+".mp3")); !os.IsNotExist(e) {
		t.Fatal("oversized retained file remained")
	}
	os.WriteFile(filepath.Join(dir, key+".mp3"), []byte("1234"), 0600)
	c.mu.Lock()
	c.jobs[key] = &job{}
	ok := c.makeRoomLocked(2)
	c.mu.Unlock()
	if ok {
		t.Fatal("active cache budget exceeded")
	}
}
