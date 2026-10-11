// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"cadence/internal/domain"
	"cadence/internal/postgres"
	"context"
	"errors"
	"net/url"
	"os"
	"testing"
	"time"
)

func reopenSchema(t *testing.T, schema string) *postgres.Store {
	t.Helper()
	u, err := url.Parse(os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	r, err := postgres.Open(context.Background(), u.String())
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestSyncLedgerPreferencesExportAndReconnect(t *testing.T) {
	r, c := fixture(t)
	ctx := context.Background()
	u, err := r.CreateUser(ctx, domain.User{Username: "syncuser", Password: "hash"}, true)
	if err != nil {
		t.Fatal(err)
	}
	other, err := r.CreateUser(ctx, domain.User{Username: "other", Password: "hash"}, false)
	if err != nil {
		t.Fatal(err)
	}
	track, err := r.UpsertTrack(ctx, domain.Track{Path: "/music/sync.mp3", Root: "/music", Title: "Song", Artist: "Artist", Duration: 300}, "scan")
	if err != nil {
		t.Fatal(err)
	}
	conn := domain.SyncConnection{Provider: "lastfm", Username: "remote", Credential: []byte("encrypted")}
	if err = r.SaveSyncConnection(ctx, u.ID, conn); err != nil {
		t.Fatal(err)
	}
	connections, err := r.SyncConnections(ctx, u.ID)
	if err != nil || len(connections) != 1 || !connections[0].Plays || !connections[0].NowPlaying || connections[0].Likes {
		t.Fatal(connections, err)
	}
	account := connections[0].ID
	// Live events must have started after connection. Historical events require explicit export.
	if _, err = c.Exec(ctx, `UPDATE sync_connections SET connected_at=now()-interval '1 hour' WHERE user_id=$1`, u.ID); err != nil {
		t.Fatal(err)
	}
	event := domain.SyncEvent{EventID: "0123456789abcdef", TrackID: track, StartedAt: time.Now().Add(-5 * time.Minute).Unix(), Heard: 150, Duration: 300}
	p := domain.SyncPayload{TrackID: track, Title: "Song", Artist: "Artist", Duration: 300, StartedAt: event.StartedAt}
	if err = r.RecordSyncListen(ctx, u.ID, event, p); err != nil {
		t.Fatal(err)
	}
	if err = r.RecordSyncListen(ctx, u.ID, event, p); err != nil {
		t.Fatal(err)
	}
	d, err := r.NextSyncDelivery(ctx)
	if err != nil || d == nil || d.UserID != u.ID || d.Payload.StartedAt != event.StartedAt {
		t.Fatal(d, err)
	}
	if err = r.FinishSyncDelivery(ctx, *d, "sent", "", time.Now()); err != nil {
		t.Fatal(err)
	}
	if d, err = r.NextSyncDelivery(ctx); err != nil || d != nil {
		t.Fatal("duplicate submitted", d, err)
	}
	if err = r.RecordPlay(ctx, u.ID, track, "legacy0123456789"); err != nil {
		t.Fatal(err)
	}
	from, to := time.Now().Add(-24*time.Hour), time.Now().Add(time.Minute)
	v, err := r.PreviewSyncExport(ctx, u.ID, "lastfm", from, to)
	if err != nil || v.Eligible != 1 || v.PreviouslySent != 1 || v.Excluded != 1 {
		t.Fatal(v, err)
	}
	job, err := r.StartSyncExport(ctx, u.ID, "lastfm", from, to)
	if err != nil || job.Sent != 1 || job.Pending != 0 {
		t.Fatal(job, err)
	}
	if _, err = r.SyncExportStatus(ctx, other.ID, job.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("cross-account export", err)
	}
	if err = r.SetSyncPreferences(ctx, u.ID, "lastfm", domain.SyncPreferences{Plays: true, NowPlaying: true, Likes: true}); err != nil {
		t.Fatal(err)
	}
	if err = r.Like(ctx, u.ID, track, true); err != nil {
		t.Fatal(err)
	}
	stale, err := r.NextSyncDelivery(ctx)
	if err != nil || stale == nil {
		t.Fatal(stale, err)
	}
	if err = r.Like(ctx, u.ID, track, false); err != nil {
		t.Fatal(err)
	}
	if err = r.FinishSyncDelivery(ctx, *stale, "sent", "", time.Now()); err != nil {
		t.Fatal(err)
	}
	d, err = r.NextSyncDelivery(ctx)
	if err != nil || d == nil || d.Kind != "like" || d.Payload.Liked {
		t.Fatal("likes not coalesced", d, err)
	}
	if err = r.SetSyncPreferences(ctx, u.ID, "lastfm", domain.SyncPreferences{Plays: true}); err != nil {
		t.Fatal(err)
	}
	if d, err = r.NextSyncDelivery(ctx); err != nil || d != nil {
		t.Fatal("disabled category remained queued", d, err)
	}
	if err = r.DeleteSyncConnection(ctx, u.ID, "lastfm"); err != nil {
		t.Fatal(err)
	}
	if err = r.SaveSyncConnection(ctx, u.ID, conn); err != nil {
		t.Fatal(err)
	}
	connections, err = r.SyncConnections(ctx, u.ID)
	if err != nil || connections[0].ID != account {
		t.Fatal("lost same-account ledger", connections, err)
	}
	job, err = r.StartSyncExport(ctx, u.ID, "lastfm", from, to)
	if err != nil || job.Sent != 1 || job.Pending != 0 {
		t.Fatal("reconnect resent history", job, err)
	}
	conn.Username = "different-account"
	if err = r.SaveSyncConnection(ctx, u.ID, conn); err != nil {
		t.Fatal(err)
	}
	v, err = r.PreviewSyncExport(ctx, u.ID, "lastfm", from, to)
	if err != nil || v.PreviouslySent != 0 {
		t.Fatal("new account inherited ledger", v, err)
	}
	job, err = r.StartSyncExport(ctx, u.ID, "lastfm", from, to)
	if err != nil || job.Pending != 1 {
		t.Fatal(job, err)
	}
	if err = r.DeleteSyncConnection(ctx, u.ID, "lastfm"); err != nil {
		t.Fatal(err)
	}
	job, err = r.SyncExportStatus(ctx, u.ID, job.ID)
	if err != nil || job.Cancelled != 1 {
		t.Fatal("disconnect did not cancel export", job, err)
	}
}

func TestSyncListenBrainzFeedbackAuthAndMigration(t *testing.T) {
	r, c := fixture(t)
	ctx := context.Background()
	u, err := r.CreateUser(ctx, domain.User{Username: "listener", Password: "hash"}, true)
	if err != nil {
		t.Fatal(err)
	}
	other, err := r.CreateUser(ctx, domain.User{Username: "other", Password: "hash"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if err = r.SaveSyncAuth(ctx, u.ID, "state-hash", time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if ok, err := r.ConsumeSyncAuth(ctx, other.ID, "state-hash"); err != nil || ok {
		t.Fatal("authorization crossed accounts", ok, err)
	}
	if ok, err := r.ConsumeSyncAuth(ctx, u.ID, "state-hash"); err != nil || !ok {
		t.Fatal(ok, err)
	}
	if ok, err := r.ConsumeSyncAuth(ctx, u.ID, "state-hash"); err != nil || ok {
		t.Fatal("authorization replay", ok, err)
	}
	if err = r.SaveSyncAuth(ctx, u.ID, "expired", time.Now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if ok, err := r.ConsumeSyncAuth(ctx, u.ID, "expired"); err != nil || ok {
		t.Fatal("expired authorization", ok, err)
	}
	track, err := r.UpsertTrack(ctx, domain.Track{Path: "/music/feedback.mp3", Root: "/music", Title: "Song", Artist: "Artist", Duration: 300}, "scan")
	if err != nil {
		t.Fatal(err)
	}
	if err = r.SaveSyncConnection(ctx, u.ID, domain.SyncConnection{Provider: "listenbrainz", Username: "remote", Credential: []byte("encrypted")}); err != nil {
		t.Fatal(err)
	}
	if err = r.SetSyncPreferences(ctx, u.ID, "listenbrainz", domain.SyncPreferences{Likes: true}); err != nil {
		t.Fatal(err)
	}
	if err = r.Like(ctx, u.ID, track, true); err != nil {
		t.Fatal(err)
	}
	connections, err := r.SyncConnections(ctx, u.ID)
	if err != nil || connections[0].WaitingFeedback != 1 {
		t.Fatal(connections, err)
	}
	if d, err := r.NextSyncDelivery(ctx); err != nil || d != nil {
		t.Fatal("unidentified feedback was sent", d, err)
	}
	p := domain.SyncPayload{TrackID: track, Title: "Song", Artist: "Artist"}
	if err = r.SaveSyncRecording(ctx, u.ID, connections[0].ID, p, "recording-msid"); err != nil {
		t.Fatal(err)
	}
	d, err := r.NextSyncDelivery(ctx)
	if err != nil || d == nil || d.RecordingID != "recording-msid" {
		t.Fatal(d, err)
	}
	if err = r.FinishSyncDelivery(ctx, *d, "auth", "Reconnect", time.Now()); err != nil {
		t.Fatal(err)
	}
	if next, err := r.NextSyncDelivery(ctx); err != nil || next != nil {
		t.Fatal("expired auth not paused", next, err)
	}
	if err = r.SaveSyncConnection(ctx, u.ID, domain.SyncConnection{Provider: "listenbrainz", Username: "remote", Credential: []byte("new-encrypted")}); err != nil {
		t.Fatal(err)
	}
	if next, err := r.NextSyncDelivery(ctx); err != nil || next == nil {
		t.Fatal("reauth did not resume", next, err)
	}
	if err = r.RecordPlay(ctx, u.ID, track, "legacy0123456789"); err != nil {
		t.Fatal(err)
	}
	if _, err = c.Exec(ctx, `DROP TABLE sync_export_deliveries,sync_exports,sync_recordings,sync_deliveries,sync_listens,sync_auth,sync_connections,sync_accounts; DELETE FROM schema_migrations WHERE version=15`); err != nil {
		t.Fatal(err)
	}
	// Reopening exercises an actual upgrade from schema 14 and preserves local history.
	var dbURL string
	if err = c.QueryRow(ctx, `SELECT current_schema()`).Scan(&dbURL); err != nil {
		t.Fatal(err)
	}
	upgraded := reopenSchema(t, dbURL)
	defer upgraded.Close()
	var count int
	if err = c.QueryRow(ctx, `SELECT count(*) FROM plays WHERE user_id=$1`, u.ID).Scan(&count); err != nil || count != 1 {
		t.Fatal("migration changed local plays", count, err)
	}
}
