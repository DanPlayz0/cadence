// SPDX-License-Identifier: GPL-2.0-or-later
package scrobble

import (
	"cadence/internal/domain"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestSignature(t *testing.T) {
	v := url.Values{"method": {"auth.getSession"}, "token": {"token"}, "api_key": {"key"}, "format": {"json"}, "callback": {"ignored"}}
	if got := signature(v, "secret"); got != "9ac306496295a8866c4a8673395540eb" {
		t.Fatalf("signature input ordering/filtering changed: %s", got)
	}
}
func TestLastFMRequestsAndResponseErrors(t *testing.T) {
	for _, tc := range []struct{ name, kind, response, want string }{
		{"accepted", "play", `{"scrobbles":{"@attr":{"accepted":"1"},"scrobble":{"ignoredMessage":{"code":"0"}}}}`, ""},
		{"ignored", "play", `{"scrobbles":{"@attr":{"accepted":"0"},"scrobble":{"ignoredMessage":{"code":"3"}}}}`, "rejected"},
		{"session expired", "play", `{"error":9,"message":"secret must not leak"}`, "auth"},
		{"temporary", "play", `{"error":16}`, "pending"},
		{"bad metadata", "play", `{"error":6}`, "rejected"},
		{"love", "like", `{}`, ""},
		{"now", "now", `{}`, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" {
					t.Error("expected POST")
				}
				_ = r.ParseForm()
				v := r.PostForm
				sig := v.Get("api_sig")
				if sig != signature(v, "secret") {
					t.Error("invalid signature")
				}
				if v.Get("artist") != "Artist & guest" || v.Get("track") != "Song" || v.Get("sk") != "session" {
					t.Error("lost metadata/session")
				}
				if tc.kind == "play" && v.Get("timestamp") != "1700000000" {
					t.Error("missing original timestamp")
				}
				if tc.name == "love" && v.Get("method") != "track.love" {
					t.Error("wrong love method")
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(tc.response))
			}))
			defer srv.Close()
			p := NewProviders("key", "secret")
			p.lastFMURL = srv.URL
			_, err := p.Send(context.Background(), "lastfm", "session", tc.kind, "", domain.SyncPayload{Title: "Song", Artist: "Artist & guest", Album: "Album", Duration: 300, StartedAt: 1700000000, Liked: true})
			if tc.want == "" {
				if err != nil {
					t.Fatal(err)
				}
			} else {
				var pe *providerError
				if !errors.As(err, &pe) || pe.kind != tc.want {
					t.Fatalf("wrong failure: %v", err)
				}
				if strings.Contains(err.Error(), "secret") {
					t.Fatal("provider error leaked")
				}
			}
		})
	}
}
func TestLastFMAuth(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("method") != "auth.getSession" || r.Form.Get("token") != "authorization-token" {
			t.Error("wrong auth request")
		}
		_, _ = w.Write([]byte(`{"session":{"name":"listener","key":"session-secret"}}`))
	}))
	defer srv.Close()
	p := NewProviders("key", "secret")
	p.lastFMURL = srv.URL
	name, key, err := p.LastFMSession(context.Background(), "authorization-token")
	if err != nil || name != "listener" || key != "session-secret" {
		t.Fatal(name, key, err)
	}
}
func TestListenBrainzRequests(t *testing.T) {
	for _, kind := range []string{"now", "play", "like"} {
		t.Run(kind, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Token personal-token" {
					t.Error("missing token")
				}
				var body map[string]json.RawMessage
				if json.NewDecoder(r.Body).Decode(&body) != nil {
					t.Fatal("invalid payload")
				}
				if kind == "like" {
					var score int
					_ = json.Unmarshal(body["score"], &score)
					if score != 0 || string(body["recording_msid"]) != `"recording-id"` {
						t.Error("unlike must clear feedback")
					}
				}
				if kind == "now" {
					if r.URL.Query().Get("return_msid") != "true" {
						t.Error("recording identifier must be requested in query")
					}
					if string(body["listen_type"]) != `"playing_now"` || strings.Contains(string(body["payload"]), "listened_at") {
						t.Error("wrong now-playing format")
					}
				}
				if kind == "play" && !strings.Contains(string(body["payload"]), `"listened_at":1700000000`) {
					t.Error("missing timestamp")
				}
				_, _ = w.Write([]byte(`{"status":"ok","recording_msid":"recording-id"}`))
			}))
			defer srv.Close()
			p := NewProviders("", "")
			p.listenBrainzURL = srv.URL + "/"
			id, err := p.Send(context.Background(), "listenbrainz", "personal-token", kind, "recording-id", domain.SyncPayload{Title: "Song", Artist: "Artist", Duration: 300, StartedAt: 1700000000})
			if err != nil || id != "recording-id" {
				t.Fatal(id, err)
			}
		})
	}
}
func TestListenBrainzTokenAndRateLimit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/validate-token" {
			_, _ = w.Write([]byte(`{"valid":true,"user_name":"listener"}`))
			return
		}
		w.Header().Set("Retry-After", "120")
		w.WriteHeader(429)
	}))
	defer srv.Close()
	p := NewProviders("", "")
	p.listenBrainzURL = srv.URL + "/"
	name, err := p.ListenBrainzUser(context.Background(), "token")
	if err != nil || name != "listener" {
		t.Fatal(name, err)
	}
	_, err = p.Send(context.Background(), "listenbrainz", "token", "play", "", domain.SyncPayload{})
	var pe *providerError
	if !errors.As(err, &pe) || pe.kind != "pending" || pe.retryAfter != 2*time.Minute {
		t.Fatal(err)
	}
}
