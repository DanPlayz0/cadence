// SPDX-License-Identifier: GPL-2.0-or-later
package library

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"cadence/internal/domain"
)

type Enricher struct {
	Repo              domain.LibraryRepository
	ArtDir, UserAgent string
	Client            *http.Client
	mu                sync.Mutex
	last              time.Time
	cache             map[string]*release
}
type release struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Date   string `json:"date"`
	Credit []struct {
		Name   string `json:"name"`
		Artist struct {
			Name string `json:"name"`
		} `json:"artist"`
	} `json:"artist-credit"`
	Score int `json:"score"`
}

var mbid = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func (e *Enricher) get(ctx context.Context, uri string) (*http.Response, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	delay := time.Until(e.last.Add(time.Second))
	if delay > 0 {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	e.last = time.Now()
	r, err := http.NewRequestWithContext(ctx, http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}
	r.Header.Set("User-Agent", e.UserAgent)
	client := e.Client
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	return client.Do(r)
}
func (e *Enricher) Suggest(ctx context.Context, t domain.Track, tags map[string]string) error {
	t.NormalizeAlbum()
	if t.Single {
		return nil
	}
	if e.UserAgent == "" {
		return fmt.Errorf("set METADATA_USER_AGENT with project/contact information before enabling enrichment")
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	key := t.AlbumID
	e.mu.Lock()
	if e.cache == nil {
		e.cache = map[string]*release{}
	}
	r, cached := e.cache[key]
	e.mu.Unlock()
	if !cached {
		id := tags["musicbrainz_albumid"]
		uri := ""
		if mbid.MatchString(id) {
			uri = "https://musicbrainz.org/ws/2/release/" + id + "?fmt=json&inc=artist-credits"
		} else {
			if t.Artist == "Unknown artist" {
				return nil
			}
			quote := func(v string) string { return strings.ReplaceAll(strings.ReplaceAll(v, `\`, `\\`), `"`, `\"`) }
			q := `release:"` + quote(t.Album) + `" AND artist:"` + quote(t.AlbumArtist) + `"`
			uri = "https://musicbrainz.org/ws/2/release/?fmt=json&limit=1&query=" + url.QueryEscape(q)
		}
		res, err := e.get(ctx, uri)
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			return fmt.Errorf("MusicBrainz returned %d; try again in a later scan", res.StatusCode)
		}
		if mbid.MatchString(id) {
			var v release
			if err = json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(&v); err != nil {
				return err
			}
			r = &v
		} else {
			var v struct {
				Releases []release `json:"releases"`
			}
			if err = json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(&v); err != nil {
				return err
			}
			if len(v.Releases) > 0 && v.Releases[0].Score >= 90 {
				r = &v.Releases[0]
			}
		}
		e.mu.Lock()
		if len(e.cache) > 10000 {
			e.cache = map[string]*release{}
		}
		e.cache[key] = r
		e.mu.Unlock()
	}
	if r == nil {
		return nil
	}
	source := "MusicBrainz release " + r.ID
	values := map[string]string{"album": r.Title, "year": r.Date}
	if len(r.Credit) > 0 {
		values["albumArtist"] = r.Credit[0].Name
		if values["albumArtist"] == "" {
			values["albumArtist"] = r.Credit[0].Artist.Name
		}
	}
	current := map[string]string{"album": t.Album, "year": t.Year, "albumArtist": t.AlbumArtist}
	for field, value := range values {
		if value != "" && value != current[field] {
			if err := e.Repo.AddSuggestion(ctx, domain.Suggestion{TrackID: t.ID, Field: field, Value: value, Source: source}); err != nil {
				return err
			}
		}
	}
	if t.ArtPath != "" || !mbid.MatchString(r.ID) {
		return nil
	}
	dest := filepath.Join(e.ArtDir, Hash("caa:"+r.ID)+".jpg")
	if _, err := os.Stat(dest); err != nil {
		res, err := e.get(ctx, "https://coverartarchive.org/release/"+r.ID+"/front-500")
		if err != nil {
			return err
		}
		defer res.Body.Close()
		if res.StatusCode == 404 {
			return nil
		}
		if res.StatusCode != 200 {
			return fmt.Errorf("Cover Art Archive returned %d", res.StatusCode)
		}
		b, err := io.ReadAll(io.LimitReader(res.Body, (8<<20)+1))
		if err != nil {
			return err
		}
		if len(b) > 8<<20 {
			return fmt.Errorf("cover too large")
		}
		kind := http.DetectContentType(b)
		if kind != "image/jpeg" && kind != "image/png" {
			return fmt.Errorf("unsupported cover content")
		}
		if err = os.MkdirAll(e.ArtDir, 0750); err != nil {
			return err
		}
		tmp := dest + ".tmp"
		if err = os.WriteFile(tmp, b, 0640); err != nil {
			return err
		}
		if err = os.Rename(tmp, dest); err != nil {
			os.Remove(tmp)
			return err
		}
	}
	return e.Repo.AddSuggestion(ctx, domain.Suggestion{TrackID: t.ID, Field: "artwork", Value: dest, Source: "Cover Art Archive release " + r.ID})
}
