// SPDX-License-Identifier: GPL-2.0-or-later
package library

import (
	"cadence/internal/domain"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

var wikidataID = regexp.MustCompile("^Q[0-9]+$")

func safeArtistURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
		return ""
	}
	return u.String()
}
func (e *Enricher) artistJSON(ctx context.Context, uri string, value any) error {
	res, err := e.get(ctx, uri)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("Artist source returned HTTP %d; try again later", res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 2<<20+1))
	if err != nil {
		return err
	}
	if len(data) > 2<<20 {
		return fmt.Errorf("Artist source response too large")
	}
	return json.Unmarshal(data, value)
}

type mbArtist struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Score          int    `json:"score"`
	Type           string `json:"type"`
	Country        string `json:"country"`
	Disambiguation string `json:"disambiguation"`
	Genres         []struct {
		Name string `json:"name"`
	} `json:"genres"`
	Relations []struct {
		Type      string    `json:"type"`
		Direction string    `json:"direction"`
		Artist    *mbArtist `json:"artist"`
		URL       struct {
			Resource string `json:"resource"`
		} `json:"url"`
	} `json:"relations"`
}

func (e *Enricher) FetchArtistProfile(ctx context.Context, name, id string) (domain.ArtistProfile, error) {
	profile := domain.ArtistProfile{Genres: []string{}, Links: []domain.ArtistLink{}, Updated: time.Now().UTC()}
	if e.UserAgent == "" {
		return profile, fmt.Errorf("Set METADATA_USER_AGENT with contact information before fetching artist data")
	}
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	if id == "" {
		var search struct {
			Artists []mbArtist `json:"artists"`
		}
		quote := func(v string) string { return strings.ReplaceAll(strings.ReplaceAll(v, `\`, `\\`), `"`, `\"`) }
		quoteName := quote(name)
		if err := e.artistJSON(ctx, "https://musicbrainz.org/ws/2/artist/?fmt=json&limit=25&query="+url.QueryEscape("artist:\""+quoteName+"\""), &search); err != nil {
			return profile, err
		}
		for _, artist := range search.Artists {
			if artist.Score >= 95 && strings.EqualFold(strings.TrimSpace(artist.Name), name) {
				if id != "" {
					return profile, fmt.Errorf("Several artists share this name. Enter the correct MusicBrainz artist ID and try again")
				}
				id = artist.ID
			}
		}
		if id == "" {
			return profile, fmt.Errorf("No reliable artist match. Enter a MusicBrainz artist ID to choose the right artist")
		}
	}
	if !mbid.MatchString(id) {
		return profile, fmt.Errorf("Enter a valid MusicBrainz artist ID")
	}
	var artist mbArtist
	if err := e.artistJSON(ctx, "https://musicbrainz.org/ws/2/artist/"+id+"?fmt=json&inc=genres+url-rels", &artist); err != nil {
		return profile, err
	}
	profile.MBID = id
	profile.Name = artist.Name
	profile.Type = artist.Type
	profile.Country = artist.Country
	profile.Description = artist.Disambiguation
	profile.Links = append(profile.Links, domain.ArtistLink{Label: "MusicBrainz", URL: "https://musicbrainz.org/artist/" + id})
	genres := map[string]bool{}
	for _, genre := range artist.Genres {
		if genre.Name != "" && !genres[genre.Name] {
			profile.Genres = append(profile.Genres, genre.Name)
			genres[genre.Name] = true
		}
	}
	sort.Strings(profile.Genres)
	wikiTitle, entity := "", ""
	links := map[string]bool{}
	for _, relation := range artist.Relations {
		resource := safeArtistURL(relation.URL.Resource)
		if resource == "" {
			continue
		}
		if !links[resource] && len(profile.Links) < 20 {
			profile.Links = append(profile.Links, domain.ArtistLink{Label: strings.ReplaceAll(relation.Type, "-", " "), URL: resource})
			links[resource] = true
		}
		u, _ := url.Parse(resource)
		if u.Hostname() == "en.wikipedia.org" && strings.HasPrefix(u.Path, "/wiki/") {
			wikiTitle = strings.TrimPrefix(u.Path, "/wiki/")
		}
		if (u.Hostname() == "www.wikidata.org" || u.Hostname() == "wikidata.org") && strings.HasPrefix(u.Path, "/wiki/") {
			candidate := strings.TrimPrefix(u.Path, "/wiki/")
			if wikidataID.MatchString(candidate) {
				entity = candidate
			}
		}
	}
	if wikiTitle == "" && entity != "" {
		var data struct {
			Entities map[string]struct {
				Sitelinks map[string]struct {
					Title string `json:"title"`
				} `json:"sitelinks"`
			} `json:"entities"`
		}
		if err := e.artistJSON(ctx, "https://www.wikidata.org/wiki/Special:EntityData/"+entity+".json", &data); err != nil {
			profile.Warning = "Artist facts saved; biography and photo lookup is temporarily unavailable."
		} else {
			wikiTitle = data.Entities[entity].Sitelinks["enwiki"].Title
		}
	}
	if wikiTitle != "" {
		var data struct {
			Query struct {
				Pages map[string]struct {
					Extract   string `json:"extract"`
					PageImage string `json:"pageimage"`
					Thumbnail struct {
						Source string `json:"source"`
					} `json:"thumbnail"`
				} `json:"pages"`
			} `json:"query"`
		}
		query := url.Values{"action": {"query"}, "format": {"json"}, "prop": {"extracts|pageimages"}, "exintro": {"1"}, "explaintext": {"1"}, "redirects": {"1"}, "pithumbsize": {"512"}, "titles": {wikiTitle}}
		if err := e.artistJSON(ctx, "https://en.wikipedia.org/w/api.php?"+query.Encode(), &data); err != nil {
			profile.Warning = "Artist facts saved; biography and photo lookup is temporarily unavailable."
		} else {
			for _, page := range data.Query.Pages {
				profile.Biography = page.Extract
				profile.Wikipedia = "https://en.wikipedia.org/wiki/" + url.PathEscape(strings.ReplaceAll(wikiTitle, " ", "_"))
				image := safeArtistURL(page.Thumbnail.Source)
				u, _ := url.Parse(image)
				if u != nil && u.Hostname() == "upload.wikimedia.org" {
					profile.Image = image
					if page.PageImage != "" {
						profile.ImageSource = "https://en.wikipedia.org/wiki/File:" + url.PathEscape(page.PageImage)
					}
				}
			}
		}
	}
	return profile, nil
}
