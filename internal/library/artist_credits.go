// SPDX-License-Identifier: GPL-2.0-or-later
package library

import (
	"context"
	"net/url"
	"regexp"
	"strings"

	"cadence/internal/domain"
)

type artistSplit struct {
	names  []string
	source string
}

var creditSeparator = regexp.MustCompile(`(?i),|\s+(?:feat\.?|ft\.?|featuring)\s+`)
var collaborationSeparator = regexp.MustCompile(`\s+&\s+`)

func normalizedArtistName(name string) string {
	return strings.ToLower(strings.Join(strings.Fields(name), " "))
}

// Require a unique, exact name match; a plausible search hit is not proof.
func (e *Enricher) matchCreditArtist(ctx context.Context, name string) (*mbArtist, bool, error) {
	quote := strings.ReplaceAll(strings.ReplaceAll(name, `\`, `\\`), `"`, `\"`)
	var search struct {
		Artists []mbArtist `json:"artists"`
	}
	if err := e.artistJSON(ctx, "https://musicbrainz.org/ws/2/artist/?fmt=json&limit=25&query="+url.QueryEscape(`artist:"`+quote+`"`), &search); err != nil {
		return nil, false, err
	}
	var match *mbArtist
	for _, artist := range search.Artists {
		if artist.Score < 95 || !mbid.MatchString(artist.ID) || normalizedArtistName(artist.Name) != normalizedArtistName(name) {
			continue
		}
		if match != nil && match.ID != artist.ID {
			return nil, true, nil
		}
		copy := artist
		match = &copy
	}
	return match, false, nil
}

func (e *Enricher) confirmCollaboration(ctx context.Context, credit string) (artistSplit, error) {
	parts := collaborationSeparator.Split(credit, -1)
	if len(parts) < 2 {
		return artistSplit{}, nil
	}
	for _, part := range parts {
		if strings.TrimSpace(part) == "" {
			return artistSplit{}, nil
		}
	}
	key := normalizedArtistName(credit)
	e.mu.Lock()
	cached, ok := e.artistSplitCache[key]
	e.mu.Unlock()
	if ok {
		return cached, nil
	}
	result, err := e.lookupCollaboration(ctx, credit, parts)
	if err != nil {
		return artistSplit{}, err // Failed requests must be retryable on a later scan.
	}
	e.mu.Lock()
	if e.artistSplitCache == nil || len(e.artistSplitCache) >= 10000 {
		e.artistSplitCache = map[string]artistSplit{}
	}
	e.artistSplitCache[key] = result
	e.mu.Unlock()
	return result, nil
}

func (e *Enricher) lookupCollaboration(ctx context.Context, credit string, parts []string) (artistSplit, error) {
	whole, ambiguous, err := e.matchCreditArtist(ctx, credit)
	if err != nil || ambiguous {
		return artistSplit{}, err
	}
	var people []mbArtist
	if whole != nil {
		// A named band stays intact unless every component is a confirmed person
		// belonging to that group (e.g. Macklemore & Ryan Lewis).
		if whole.Type != "Group" {
			return artistSplit{}, nil
		}
		var group mbArtist
		if err := e.artistJSON(ctx, "https://musicbrainz.org/ws/2/artist/"+whole.ID+"?fmt=json&inc=artist-rels", &group); err != nil {
			return artistSplit{}, err
		}
		if group.ID != whole.ID || group.Type != "Group" {
			return artistSplit{}, nil
		}
		for _, part := range parts {
			var person *mbArtist
			for _, relation := range group.Relations {
				member := relation.Artist
				if relation.Type != "member of band" || relation.Direction != "backward" || member == nil || member.Type != "Person" || !mbid.MatchString(member.ID) || normalizedArtistName(member.Name) != normalizedArtistName(part) {
					continue
				}
				if person != nil && person.ID != member.ID {
					return artistSplit{}, nil
				}
				person = member
			}
			if person == nil {
				return artistSplit{}, nil
			}
			people = append(people, *person)
		}
	} else {
		for _, part := range parts {
			person, ambiguous, err := e.matchCreditArtist(ctx, strings.TrimSpace(part))
			if err != nil {
				return artistSplit{}, err
			}
			if ambiguous || person == nil || person.Type != "Person" {
				return artistSplit{}, nil
			}
			people = append(people, *person)
		}
	}
	result := artistSplit{}
	ids := map[string]bool{}
	for _, person := range people {
		if ids[person.ID] {
			return artistSplit{}, nil
		}
		ids[person.ID] = true
		result.names = append(result.names, person.Name)
	}
	if whole != nil {
		result.source = "MusicBrainz confirmed artist split " + whole.ID
	} else {
		var orderedIDs []string
		for _, person := range people {
			orderedIDs = append(orderedIDs, person.ID)
		}
		result.source = "MusicBrainz confirmed artist split " + strings.Join(orderedIDs, ",")
	}
	return result, nil
}

func (e *Enricher) splitArtistCredit(ctx context.Context, track domain.Track) error {
	if !collaborationSeparator.MatchString(track.Artist) {
		return nil
	}
	var names, sources []string
	changed := false
	seen := map[string]bool{}
	for _, credit := range creditSeparator.Split(track.Artist, -1) {
		credit = strings.TrimSpace(credit)
		if credit == "" {
			continue
		}
		result, err := e.confirmCollaboration(ctx, credit)
		if err != nil {
			return err
		}
		if len(result.names) == 0 {
			result.names = []string{credit}
		} else {
			changed = true
			sources = append(sources, result.source)
		}
		for _, name := range result.names {
			if !seen[name] {
				names = append(names, name)
				seen[name] = true
			}
		}
	}
	if !changed {
		return nil
	}
	_, err := e.Repo.ApplyConfirmedArtistSplit(ctx, track.ID, track.Artist, strings.Join(names, ", "), strings.Join(sources, "; "))
	return err
}
