// SPDX-License-Identifier: GPL-2.0-or-later
package soulseek

import (
	"context"
	"encoding/json"
	"gopkg.in/yaml.v3"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientContract(t *testing.T) {
	var yamlSaved string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/v0/options/") {
			if r.Header.Get("Authorization") != "Bearer token" {
				t.Error("missing JWT")
			}
		} else if r.Header.Get("X-API-Key") != "secret" {
			t.Error("missing API key")
		}
		switch r.URL.Path {
		case "/api/v0/searches":
			var v map[string]any
			json.NewDecoder(r.Body).Decode(&v)
			if v["searchText"] != "artist song" || v["fileLimit"] != float64(5000) {
				t.Error(v)
			}
			json.NewEncoder(w).Encode(map[string]string{"id": "id"})
		case "/api/v0/searches/id":
			if r.URL.Query().Get("includeResponses") != "true" {
				t.Error("responses missing")
			}
			w.Write([]byte(`{"state":"Completed","responses":[{"username":"peer","queueLength":2,"files":[{"filename":"Music\\Album\\song.flac","size":100,"bitDepth":24},{"filename":"Music\\Album\\cover.jpg","size":10}]}]}`))
		case "/api/v0/users/peer/directory":
			w.Write([]byte(`[{"name":"Music\\Album","files":[{"filename":"one.mp3","size":10},{"filename":"two.flac","size":20},{"filename":"cover.jpg","size":30}]}]`))
		case "/api/v0/session":
			w.Write([]byte(`{"token":"token"}`))
		case "/api/v0/options/yaml":
			if r.Method == "GET" {
				json.NewEncoder(w).Encode("soulseek:\n  password: keep-secret\nshares:\n  directories:\n    - /operator-share\n    - /old-managed\nother: true\n")
			} else {
				json.NewDecoder(r.Body).Decode(&yamlSaved)
				w.Write([]byte(`{}`))
			}
		default:
			t.Error("unexpected route", r.URL.Path)
		}
	}))
	defer server.Close()
	c := NewClient(server.URL, "secret", "admin", "password")
	ctx := context.Background()
	if e := c.StartSearch(ctx, "id", "artist song"); e != nil {
		t.Fatal(e)
	}
	results, e := c.Search(ctx, "id")
	if e != nil || len(results.Results) != 1 || results.Results[0].Folder != "Music/Album" || results.Results[0].BitDepth != 24 {
		t.Fatal(results, e)
	}
	folder, e := c.Folder(ctx, "peer", "Music/Album")
	if e != nil || len(folder) != 2 || folder[1].Filename != `Music\Album\two.flac` {
		t.Fatal(folder, e)
	}
	if e = c.SyncShares(ctx, []string{"/old-managed"}, []string{"/new-managed"}); e != nil {
		t.Fatal(e)
	}
	var parsed map[string]any
	if e = yaml.Unmarshal([]byte(yamlSaved), &parsed); e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(yamlSaved, "keep-secret") || !strings.Contains(yamlSaved, "/operator-share") || strings.Contains(yamlSaved, "/old-managed") {
		t.Fatal("unrelated config changed")
	}
}
func TestClientDoesNotExposeRemoteErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		w.Write([]byte("private secret password"))
	}))
	c := NewClient(server.URL, "secret", "", "")
	_, e := c.Search(context.Background(), "id")
	if e == nil || strings.Contains(e.Error(), "password") {
		t.Fatal(e)
	}
	server.Close()
	_, e = c.Search(context.Background(), "id")
	if e != ErrUnavailable {
		t.Fatal(e)
	}
}
