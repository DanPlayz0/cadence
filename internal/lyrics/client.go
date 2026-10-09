// SPDX-License-Identifier: GPL-2.0-or-later
package lyrics

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"cadence/internal/domain"
)

var ErrUnavailable = errors.New("lyrics provider unavailable")

type Result struct {
	Found        bool   `json:"found"`
	Instrumental bool   `json:"instrumental"`
	Plain        string `json:"plainLyrics"`
	Synced       string `json:"syncedLyrics"`
	Source       string `json:"source"`
}
type entry struct {
	result  Result
	expires time.Time
}
type Client struct {
	HTTP      *http.Client
	UserAgent string
	gate      chan struct{}
	cache     map[string]entry
	next      time.Time
	cooldown  time.Time
}

func New() *Client {
	return &Client{UserAgent: "Cadence/0.1.0 (http://localhost:8080)", HTTP: &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, gate: make(chan struct{}, 1), cache: make(map[string]entry)}
}

func (c *Client) Lookup(ctx context.Context, track domain.Track) (Result, error) {
	empty := Result{Source: "LRCLIB"}
	if strings.TrimSpace(track.Title) == "" || strings.TrimSpace(track.Artist) == "" || track.Artist == "Unknown artist" || math.IsNaN(track.Duration) || math.IsInf(track.Duration, 0) || track.Duration < 1 || track.Duration > 3600 {
		return empty, nil
	}
	select {
	case c.gate <- struct{}{}:
	case <-ctx.Done():
		return empty, ctx.Err()
	}
	defer func() { <-c.gate }()
	params := url.Values{"track_name": {track.Title}, "artist_name": {track.Artist}, "duration": {strconv.FormatFloat(track.Duration, 'f', 2, 64)}}
	if track.Album != "" {
		params.Set("album_name", track.Album)
	}
	key := params.Encode()
	if cached, ok := c.cache[key]; ok && time.Now().Before(cached.expires) {
		return cached.result, nil
	}
	result, err := c.get(ctx, params)
	// Folder-derived album names often differ from the release; keep title,
	// artist and duration constraints when trying without the album.
	if err == nil && !result.Found && params.Has("album_name") {
		params.Del("album_name")
		result, err = c.get(ctx, params)
	}
	if err != nil {
		return empty, err
	}
	ttl := 24 * time.Hour
	if !result.Found {
		ttl = 5 * time.Minute
	}
	if len(c.cache) >= 64 {
		var oldest string
		var expiry time.Time
		for k, v := range c.cache {
			if oldest == "" || v.expires.Before(expiry) {
				oldest = k
				expiry = v.expires
			}
		}
		delete(c.cache, oldest)
	}
	c.cache[key] = entry{result, time.Now().Add(ttl)}
	return result, nil
}
func (c *Client) get(ctx context.Context, params url.Values) (Result, error) {
	empty := Result{Source: "LRCLIB"}
	if time.Now().Before(c.cooldown) {
		return empty, ErrUnavailable
	}
	if delay := time.Until(c.next); delay > 0 {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-ctx.Done():
			return empty, ctx.Err()
		}
	}
	req, err := http.NewRequestWithContext(ctx, "GET", "https://lrclib.net/api/get?"+params.Encode(), nil)
	if err != nil {
		return empty, err
	}
	req.Header.Set("User-Agent", c.UserAgent)
	req.Header.Set("Accept", "application/json")
	response, err := c.HTTP.Do(req)
	c.next = time.Now().Add(300 * time.Millisecond)
	if err != nil {
		return empty, ErrUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusTooManyRequests || response.StatusCode == http.StatusServiceUnavailable {
		until := time.Now().Add(time.Minute)
		retry := response.Header.Get("Retry-After")
		if seconds, e := strconv.Atoi(retry); e == nil && seconds >= 0 {
			until = time.Now().Add(time.Duration(seconds) * time.Second)
		} else if date, e := http.ParseTime(retry); e == nil {
			until = date
		}
		if until.After(c.next) {
			c.next = until
		}
		c.cooldown = c.next
		return empty, ErrUnavailable
	}
	if response.StatusCode == http.StatusNotFound {
		return empty, nil
	}
	if response.StatusCode != http.StatusOK {
		return empty, ErrUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(body) > 1<<20 {
		return empty, ErrUnavailable
	}
	var record struct {
		Instrumental bool   `json:"instrumental"`
		Plain        string `json:"plainLyrics"`
		Synced       string `json:"syncedLyrics"`
	}
	if json.Unmarshal(body, &record) != nil || len(record.Plain)+len(record.Synced) > 256<<10 {
		return empty, ErrUnavailable
	}
	return Result{Found: record.Instrumental || strings.TrimSpace(record.Plain) != "" || strings.TrimSpace(record.Synced) != "", Instrumental: record.Instrumental, Plain: record.Plain, Synced: record.Synced, Source: "LRCLIB"}, nil
}
