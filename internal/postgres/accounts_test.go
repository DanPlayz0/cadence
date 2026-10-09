// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"

	"cadence/internal/domain"
	"cadence/internal/httpapi"
	"cadence/internal/postgres"
	"golang.org/x/crypto/bcrypt"
)

func TestUserAvatarUpgrade(t *testing.T) {
	r, c := fixture(t)
	ctx := context.Background()
	u, err := r.CreateUser(ctx, domain.User{Username: "existing", DisplayName: "Existing listener", Password: "unchanged"}, true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = c.Exec(ctx, "ALTER TABLE users DROP COLUMN avatar; ALTER TABLE users DROP COLUMN avatar_version; DELETE FROM schema_migrations WHERE version=4"); err != nil {
		t.Fatal(err)
	}
	var schema string
	if err = c.QueryRow(ctx, "SELECT current_schema()").Scan(&schema); err != nil {
		t.Fatal(err)
	}
	uri, _ := url.Parse(os.Getenv("TEST_DATABASE_URL"))
	query := uri.Query()
	query.Set("search_path", schema)
	uri.RawQuery = query.Encode()
	upgraded, err := postgres.Open(ctx, uri.String())
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	stored, err := upgraded.UserByID(ctx, u.ID)
	if err != nil || stored.Avatar || stored.AvatarVersion != 0 || stored.Password != "unchanged" || stored.DisplayName != "Existing listener" {
		t.Fatal("account not preserved through avatar migration", err)
	}
}

func TestAccountManagement(t *testing.T) {
	r, _ := fixture(t)
	ctx := context.Background()
	hash, _ := bcrypt.GenerateFromPassword([]byte("original-password"), bcrypt.MinCost)
	owner, err := r.CreateUser(ctx, domain.User{Username: "owner", DisplayName: "Owner", Password: string(hash)}, true)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := r.CreateUser(ctx, domain.User{Username: "listener", DisplayName: "Listener", Password: string(hash)}, false)
	if err != nil {
		t.Fatal(err)
	}
	makeSession := func(user domain.User, token string) {
		t.Helper()
		sum := sha256.Sum256([]byte(token))
		if err := r.SaveSession(ctx, hex.EncodeToString(sum[:]), user.ID, "proof", time.Now().Add(time.Hour), user.Password); err != nil {
			t.Fatal(err)
		}
	}
	makeSession(owner, "owner")
	makeSession(listener, "listener")
	makeSession(listener, "other-listener")
	handler := (&httpapi.Server{Repo: r, Config: httpapi.Config{PublicURL: "http://example.test"}}).Handler()
	request := func(method, path, token string, body []byte, csrf bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/v1"+path, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if csrf {
			req.Header.Set("X-CSRF-Token", "proof")
		}
		if token != "" {
			req.AddCookie(&http.Cookie{Name: "cadence_session", Value: token})
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	check := func(w *httptest.ResponseRecorder, status int) {
		t.Helper()
		if w.Code != status {
			t.Fatalf("want %d got %d: %s", status, w.Code, w.Body.String())
		}
	}
	profilePath := "/admin/users/" + listener.ID
	check(request("PUT", "/me", "", []byte(`{"displayName":"Edited"}`), true), 401)
	check(request("PUT", "/me", "listener", []byte(`{"displayName":"Edited"}`), false), 403)
	check(request("PUT", "/me", "listener", []byte(`{"displayName":"Edited","admin":true}`), true), 400)
	check(request("PUT", profilePath, "listener", []byte(`{"username":"stolen"}`), true), 403)
	check(request("POST", profilePath+"/password", "listener", []byte(`{"password":"unauthorized"}`), true), 403)
	check(request("PUT", profilePath+"/avatar", "listener", []byte("invalid"), true), 403)
	check(request("PUT", "/me", "listener", []byte(`{"displayName":" New Listener "}`), true), 200)
	me := request("GET", "/me", "listener", nil, false)
	check(me, 200)
	if !bytes.Contains(me.Body.Bytes(), []byte("New Listener")) || bytes.Contains(me.Body.Bytes(), []byte("password")) {
		t.Fatal("profile response stale or leaked password")
	}
	check(request("POST", "/me/password", "listener", []byte(`{"password":"changed-password"}`), true), 403)
	check(request("POST", "/me/password", "listener", []byte(`{"password":"changed-password","currentPassword":"wrong"}`), true), 403)
	check(request("POST", "/me/password", "listener", []byte(`{"password":"ab","currentPassword":"original-password"}`), true), 400)
	check(request("POST", "/me/password", "listener", []byte(`{"password":"changed-password","currentPassword":"original-password"}`), true), 200)
	check(request("GET", "/me", "listener", nil, false), 200)
	check(request("GET", "/me", "other-listener", nil, false), 401)
	u, err := r.UserByID(ctx, listener.ID)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(u.Password), []byte("changed-password")) != nil {
		t.Fatal("password not updated", err)
	}
	if err = r.SaveSession(ctx, "stale-login", listener.ID, "proof", time.Now().Add(time.Hour), listener.Password); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("stale password created a session", err)
	}

	group, err := r.CreateGroup(ctx, "Family")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{"username": " RENAMED ", "groups": []string{group.ID}})
	check(request("PUT", profilePath, "owner", body, true), 200)
	u, err = r.UserByID(ctx, listener.ID)
	if err != nil || u.Username != "renamed" || len(u.Groups) != 1 || u.Groups[0] != group.ID {
		t.Fatal("username/groups not persisted", err)
	}
	check(request("PUT", profilePath, "owner", []byte(`{"username":"owner","groups":[]}`), true), 409)
	check(request("PUT", profilePath, "owner", []byte(`{"username":"partial","groups":["missing"]}`), true), 409)
	u, _ = r.UserByID(ctx, listener.ID)
	if u.Username != "renamed" || len(u.Groups) != 1 {
		t.Fatal("failed update partially committed")
	}
	check(request("PUT", "/admin/users/missing", "owner", []byte(`{"username":"missing"}`), true), 404)

	var photo bytes.Buffer
	png.Encode(&photo, image.NewRGBA(image.Rect(0, 0, 32, 20)))
	check(request("PUT", "/me/avatar", "listener", photo.Bytes(), false), 403)
	check(request("PUT", "/me/avatar", "listener", []byte("not an image"), true), 400)
	check(request("PUT", "/me/avatar", "listener", make([]byte, (2<<20)+1), true), 413)
	check(request("PUT", "/me/avatar", "listener", photo.Bytes(), true), 200)
	avatar := request("GET", "/users/"+listener.ID+"/avatar", "listener", nil, false)
	check(avatar, 200)
	if avatar.Header().Get("Content-Type") != "image/jpeg" || avatar.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("avatar headers invalid")
	}
	check(request("GET", "/users/"+listener.ID+"/avatar", "owner", nil, false), 200)
	check(request("GET", "/users/"+owner.ID+"/avatar", "listener", nil, false), 403)
	check(request("DELETE", profilePath+"/avatar", "owner", nil, true), 200)
	check(request("GET", "/users/"+listener.ID+"/avatar", "listener", nil, false), 404)
	check(request("PUT", profilePath+"/avatar", "owner", photo.Bytes(), true), 200)
	u, _ = r.UserByID(ctx, listener.ID)
	if !u.Avatar || u.AvatarVersion != 3 {
		t.Fatal("avatar updates/removal not versioned")
	}
	check(request("DELETE", "/me/avatar", "listener", nil, true), 200)
	u, _ = r.UserByID(ctx, listener.ID)
	if u.Avatar {
		t.Fatal("self avatar removal failed")
	}

	check(request("POST", profilePath+"/password", "owner", []byte(`{"password":"reset-password"}`), true), 200)
	check(request("GET", "/me", "listener", nil, false), 401)
	u, _ = r.UserByID(ctx, listener.ID)
	if bcrypt.CompareHashAndPassword([]byte(u.Password), []byte("reset-password")) != nil {
		t.Fatal("admin password reset failed")
	}
	check(request("POST", "/login", "", []byte(`{"username":"listener","password":"reset-password"}`), false), 401)
	check(request("POST", "/login", "", []byte(`{"username":"RENAMED","password":"changed-password"}`), false), 401)
	check(request("POST", "/login", "", []byte(`{"username":"RENAMED","password":"reset-password"}`), false), 200)
	makeSession(u, "revoke-me")
	check(request("DELETE", profilePath+"/sessions", "owner", nil, true), 200)
	check(request("GET", "/me", "revoke-me", nil, false), 401)
}
