// SPDX-License-Identifier: GPL-2.0-or-later
package scrobble

import (
	"cadence/internal/domain"
	"context"
	"crypto/md5" // Last.fm requires MD5 API signatures, not password hashing.
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type providerError struct {
	kind, message string
	retryAfter    time.Duration
}

func (e *providerError) Error() string { return e.message }

type Providers struct {
	APIKey, Secret             string
	client                     *http.Client
	lastFMURL, listenBrainzURL string
	mu                         sync.Mutex
	nextRequest                map[string]time.Time
}

func NewProviders(key, secret string) *Providers {
	return &Providers{APIKey: key, Secret: secret, client: &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, lastFMURL: "https://ws.audioscrobbler.com/2.0/", listenBrainzURL: "https://api.listenbrainz.org/1/"}
}
func (p *Providers) Configured() bool { return p.APIKey != "" && p.Secret != "" }
func signature(v url.Values, secret string) string {
	keys := []string{}
	for k := range v {
		if k != "format" && k != "callback" && k != "api_sig" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		b.WriteString(k)
		b.WriteString(v.Get(k))
	}
	b.WriteString(secret)
	sum := md5.Sum([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}
func (p *Providers) request(ctx context.Context, method, endpoint, token string, body io.Reader, contentType string) (map[string]json.RawMessage, error) {
	// Keep independent provider budgets; never hold a request beyond its context.
	u, _ := url.Parse(endpoint)
	host := u.Host
	p.mu.Lock()
	if p.nextRequest == nil {
		p.nextRequest = map[string]time.Time{}
	}
	wait := time.Until(p.nextRequest[host])
	if wait < 0 {
		wait = 0
	}
	p.nextRequest[host] = time.Now().Add(wait + time.Second)
	p.mu.Unlock()
	if wait > 0 {
		timer := time.NewTimer(wait)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return nil, &providerError{kind: "pending", message: "Service request timed out"}
		case <-timer.C:
		}
	}
	r, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, &providerError{kind: "rejected", message: "Invalid provider request"}
	}
	r.Header.Set("User-Agent", "Cadence/0.1.0")
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	if token != "" {
		r.Header.Set("Authorization", "Token "+token)
	}
	res, err := p.client.Do(r)
	if err != nil {
		return nil, &providerError{kind: "pending", message: "Service could not be reached; retrying"}
	}
	defer res.Body.Close()
	if res.StatusCode == 401 || res.StatusCode == 403 {
		return nil, &providerError{kind: "auth", message: "Authorization expired; reconnect this account"}
	}
	if res.StatusCode == 429 || res.StatusCode >= 500 {
		d := time.Minute
		if seconds, e := strconv.Atoi(res.Header.Get("Retry-After")); e == nil && seconds > 0 {
			d = time.Duration(seconds) * time.Second
		} else if date, e := http.ParseTime(res.Header.Get("Retry-After")); e == nil && time.Until(date) > 0 {
			d = time.Until(date)
		}
		p.mu.Lock()
		if until := time.Now().Add(d); until.After(p.nextRequest[host]) {
			p.nextRequest[host] = until
		}
		p.mu.Unlock()
		return nil, &providerError{kind: "pending", message: "Service is busy or unavailable; retrying", retryAfter: d}
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, &providerError{kind: "rejected", message: fmt.Sprintf("Service rejected the request (HTTP %d)", res.StatusCode)}
	}
	var v map[string]json.RawMessage
	if err = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&v); err != nil {
		return nil, &providerError{kind: "pending", message: "Invalid service response; retrying"}
	}
	return v, nil
}
func (p *Providers) lastFM(ctx context.Context, v url.Values) (map[string]json.RawMessage, error) {
	v.Set("api_key", p.APIKey)
	v.Set("api_sig", signature(v, p.Secret))
	v.Set("format", "json")
	r, err := p.request(ctx, "POST", p.lastFMURL, "", strings.NewReader(v.Encode()), "application/x-www-form-urlencoded")
	if err != nil {
		return nil, err
	}
	var code int
	_ = json.Unmarshal(r["error"], &code)
	if code != 0 {
		kind := "rejected"
		message := "Last.fm rejected the request"
		if code == 9 || code == 4 {
			kind = "auth"
			message = "Last.fm authorization expired; reconnect this account"
		}
		if code == 11 || code == 16 || code == 29 {
			kind = "pending"
			message = "Last.fm is busy or unavailable; retrying"
		}
		return nil, &providerError{kind: kind, message: message}
	}
	return r, nil
}
func (p *Providers) LastFMSession(ctx context.Context, token string) (string, string, error) {
	r, err := p.lastFM(ctx, url.Values{"method": {"auth.getSession"}, "token": {token}})
	if err != nil {
		return "", "", err
	}
	var s struct{ Name, Key string }
	if json.Unmarshal(r["session"], &s) != nil || s.Name == "" || s.Key == "" {
		return "", "", &providerError{kind: "rejected", message: "Last.fm did not return an authorized account"}
	}
	return s.Name, s.Key, nil
}
func (p *Providers) ListenBrainzUser(ctx context.Context, token string) (string, error) {
	r, err := p.request(ctx, "GET", p.listenBrainzURL+"validate-token", token, nil, "")
	if err != nil {
		return "", err
	}
	var valid bool
	var name string
	_ = json.Unmarshal(r["valid"], &valid)
	_ = json.Unmarshal(r["user_name"], &name)
	if !valid || name == "" {
		return "", &providerError{kind: "auth", message: "Invalid ListenBrainz token"}
	}
	return name, nil
}
func (p *Providers) Send(ctx context.Context, provider, credential, kind, recordingID string, t domain.SyncPayload) (string, error) {
	if provider == "lastfm" {
		method := "track.scrobble"
		if kind == "now" {
			method = "track.updateNowPlaying"
		}
		if kind == "like" {
			method = "track.unlove"
			if t.Liked {
				method = "track.love"
			}
		}
		v := url.Values{"method": {method}, "sk": {credential}, "artist": {t.Artist}, "track": {t.Title}}
		if kind != "like" {
			if t.Album != "" {
				v.Set("album", t.Album)
			}
			v.Set("duration", strconv.Itoa(int(t.Duration)))
			if kind == "play" {
				v.Set("timestamp", strconv.FormatInt(t.StartedAt, 10))
			}
		}
		r, err := p.lastFM(ctx, v)
		if err != nil {
			return "", err
		}
		if kind == "play" {
			var result struct {
				Attr struct {
					Accepted string `json:"accepted"`
				} `json:"@attr"`
				Scrobble struct {
					Ignored struct {
						Code string `json:"code"`
					} `json:"ignoredMessage"`
				} `json:"scrobble"`
			}
			if json.Unmarshal(r["scrobbles"], &result) != nil || result.Attr.Accepted != "1" {
				return "", &providerError{kind: "rejected", message: "Last.fm ignored this listen (metadata, timestamp, or daily limit)"}
			}
		}
		return "", nil
	}
	if provider != "listenbrainz" {
		return "", &providerError{kind: "rejected", message: "Unknown sync provider"}
	}
	var endpoint string
	var body any
	if kind == "like" {
		score := 0
		if t.Liked {
			score = 1
		}
		endpoint = "feedback/recording-feedback"
		body = map[string]any{"recording_msid": recordingID, "score": score}
	} else {
		listenType := "single"
		listen := map[string]any{"listened_at": t.StartedAt, "track_metadata": map[string]any{"artist_name": t.Artist, "track_name": t.Title, "release_name": t.Album, "additional_info": map[string]any{"submission_client": "Cadence", "duration_ms": int(t.Duration * 1000)}}}
		if kind == "now" {
			listenType = "playing_now"
			delete(listen, "listened_at")
		}
		endpoint = "submit-listens"
		body = map[string]any{"listen_type": listenType, "payload": []any{listen}}
		if kind == "now" {
			endpoint += "?return_msid=true"
		}
	}
	b, _ := json.Marshal(body)
	r, err := p.request(ctx, "POST", p.listenBrainzURL+endpoint, credential, strings.NewReader(string(b)), "application/json")
	if err != nil {
		return "", err
	}
	var status string
	_ = json.Unmarshal(r["status"], &status)
	if status != "ok" {
		return "", &providerError{kind: "rejected", message: "ListenBrainz rejected the submission"}
	}
	var id string
	_ = json.Unmarshal(r["recording_msid"], &id)
	return id, nil
}
