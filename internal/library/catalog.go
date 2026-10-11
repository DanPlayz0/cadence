// SPDX-License-Identifier: GPL-2.0-or-later
package library

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var ErrCatalogUnavailable = errors.New("Catalog discovery is unavailable; configure METADATA_USER_AGENT with application/contact information")

type CatalogItem struct {
	ID             string `json:"id"`
	Kind           string `json:"kind"`
	Name           string `json:"name"`
	Artist         string `json:"artist"`
	Date           string `json:"date"`
	ReleaseType    string `json:"releaseType"`
	Disambiguation string `json:"disambiguation"`
}
type CatalogPage struct {
	Items  []CatalogItem `json:"items"`
	Total  int           `json:"total"`
	Limit  int           `json:"limit"`
	Offset int           `json:"offset"`
}
type catalogCacheEntry struct {
	data    []byte
	expires time.Time
}
type catalogEntity struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Title          string `json:"title"`
	Date           string `json:"first-release-date"`
	Type           string `json:"primary-type"`
	Disambiguation string `json:"disambiguation"`
	Credit         []struct {
		Name   string `json:"name"`
		Join   string `json:"joinphrase"`
		Artist struct {
			Name string `json:"name"`
		} `json:"artist"`
	} `json:"artist-credit"`
}

func (v catalogEntity) item(kind string) CatalogItem {
	name := v.Title
	if kind == "artist" {
		name = v.Name
	}
	var credit strings.Builder
	for _, c := range v.Credit {
		n := c.Name
		if n == "" {
			n = c.Artist.Name
		}
		credit.WriteString(n)
		credit.WriteString(c.Join)
	}
	return CatalogItem{ID: v.ID, Kind: kind, Name: name, Artist: credit.String(), Date: v.Date, ReleaseType: v.Type, Disambiguation: v.Disambiguation}
}
func (e *Enricher) catalogJSON(ctx context.Context, resource string, value any) error {
	if strings.TrimSpace(e.UserAgent) == "" {
		return ErrCatalogUnavailable
	}
	e.mu.Lock()
	cached, ok := e.catalogCache[resource]
	e.mu.Unlock()
	if ok && time.Now().Before(cached.expires) {
		return json.Unmarshal(cached.data, value)
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	res, err := e.get(ctx, "https://musicbrainz.org/ws/2/"+resource)
	if err != nil {
		return fmt.Errorf("Catalog provider could not be reached; retry shortly: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("Catalog provider returned HTTP %d; retry shortly", res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, (2<<20)+1))
	if err != nil {
		return err
	}
	if len(data) > 2<<20 {
		return errors.New("Catalog response too large; narrow your search")
	}
	if err = json.Unmarshal(data, value); err != nil {
		return errors.New("Catalog provider returned an invalid response; retry shortly")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.catalogCache == nil {
		e.catalogCache = map[string]catalogCacheEntry{}
	}
	if len(e.catalogCache) >= 256 {
		oldest := ""
		var expiry time.Time
		for key, entry := range e.catalogCache {
			if oldest == "" || entry.expires.Before(expiry) {
				oldest = key
				expiry = entry.expires
			}
		}
		delete(e.catalogCache, oldest)
	}
	e.catalogCache[resource] = catalogCacheEntry{data: data, expires: time.Now().Add(10 * time.Minute)}
	return nil
}
func (e *Enricher) CatalogSearch(ctx context.Context, kind, query string, limit, offset int) (CatalogPage, error) {
	resource := map[string]string{"artist": "artist", "album": "release-group", "song": "recording"}[kind]
	if resource == "" {
		return CatalogPage{}, errors.New("Choose artist, album, or song")
	}
	return e.catalogPage(ctx, kind, resource+"?"+url.Values{"fmt": {"json"}, "query": {query}, "limit": {strconv.Itoa(limit)}, "offset": {strconv.Itoa(offset)}}.Encode(), limit, offset)
}
func (e *Enricher) CatalogArtistAlbums(ctx context.Context, id string, limit, offset int) (CatalogPage, error) {
	if !mbid.MatchString(id) {
		return CatalogPage{}, errors.New("Invalid catalog artist ID")
	}
	return e.catalogPage(ctx, "album", "release-group?"+url.Values{"fmt": {"json"}, "artist": {id}, "inc": {"artist-credits"}, "limit": {strconv.Itoa(limit)}, "offset": {strconv.Itoa(offset)}}.Encode(), limit, offset)
}
func (e *Enricher) catalogPage(ctx context.Context, kind, resource string, limit, offset int) (CatalogPage, error) {
	var raw struct {
		Count       int             `json:"count"`
		ArtistCount int             `json:"artist-count"`
		AlbumCount  int             `json:"release-group-count"`
		SongCount   int             `json:"recording-count"`
		Artists     []catalogEntity `json:"artists"`
		Albums      []catalogEntity `json:"release-groups"`
		Songs       []catalogEntity `json:"recordings"`
	}
	page := CatalogPage{Items: []CatalogItem{}, Limit: limit, Offset: offset}
	if err := e.catalogJSON(ctx, resource, &raw); err != nil {
		return page, err
	}
	items, total := raw.Albums, raw.AlbumCount
	if kind == "artist" {
		items, total = raw.Artists, raw.ArtistCount
	}
	if kind == "song" {
		items, total = raw.Songs, raw.SongCount
	}
	if raw.Count > total {
		total = raw.Count
	}
	page.Total = total
	for _, v := range items {
		page.Items = append(page.Items, v.item(kind))
	}
	return page, nil
}
func (e *Enricher) CatalogAlbum(ctx context.Context, id string) (CatalogItem, error) {
	if !mbid.MatchString(id) {
		return CatalogItem{}, errors.New("Invalid catalog album ID")
	}
	var raw catalogEntity
	err := e.catalogJSON(ctx, "release-group/"+id+"?fmt=json&inc=artist-credits", &raw)
	return raw.item("album"), err
}
