// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"cadence/internal/domain"
	"context"
	"errors"
	"sync"
	"testing"
)

func TestPlaybackOrderingIsolationAccessAndMigration(t *testing.T) {
	r, c := fixture(t)
	ctx := context.Background()
	user, err := r.CreateUser(ctx, domain.User{Username: "listener", Password: "hash"}, true)
	if err != nil {
		t.Fatal(err)
	}
	other, err := r.CreateUser(ctx, domain.User{Username: "other", Password: "hash"}, false)
	if err != nil {
		t.Fatal(err)
	}
	id, err := r.UpsertTrack(ctx, domain.Track{Path: "/music/song.mp3", Root: "/music", Title: "Song", Duration: 100}, "scan")
	if err != nil {
		t.Fatal(err)
	}
	v, err := r.Playback(ctx, user.ID)
	if err != nil || v.Revision != 0 || v.TrackID != "" {
		t.Fatal(v, err)
	}
	first := domain.Playback{TrackID: id, Position: 42.5, Writer: "0123456789abcdef", Sequence: 1}
	v, err = r.SavePlayback(ctx, user.ID, first)
	if err != nil || v.Revision != 1 || v.Position != 42.5 {
		t.Fatal(v, err)
	}
	// Out-of-order checkpoints from one tab cannot rewind saved progress.
	later := first
	later.Sequence = 3
	later.Position = 70
	v, err = r.SavePlayback(ctx, user.ID, later)
	if err != nil || v.Revision != 2 {
		t.Fatal(v, err)
	}
	earlier := first
	earlier.Sequence = 2
	earlier.Position = 50
	if _, err = r.SavePlayback(ctx, user.ID, earlier); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("late write", err)
	}
	remote := domain.Playback{TrackID: id, Position: 20, Writer: "abcdef0123456789", Sequence: 1, Revision: 1}
	if _, err = r.SavePlayback(ctx, user.ID, remote); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("stale device", err)
	}
	remote.Revision = 2
	v, err = r.SavePlayback(ctx, user.ID, remote)
	if err != nil || v.Revision != 3 {
		t.Fatal(v, err)
	}
	later.Sequence = 4
	if _, err = r.SavePlayback(ctx, user.ID, later); !errors.Is(err, domain.ErrConflict) {
		t.Fatal("former device", err)
	}
	// Two devices observing the same revision: exactly one claims ownership.
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, writer := range []string{"1111111111111111", "2222222222222222"} {
		wg.Add(1)
		go func(writer string) {
			defer wg.Done()
			_, e := r.SavePlayback(ctx, user.ID, domain.Playback{TrackID: id, Position: 30, Writer: writer, Sequence: 1, Revision: 3})
			results <- e
		}(writer)
	}
	wg.Wait()
	close(results)
	success, conflicts := 0, 0
	for e := range results {
		if e == nil {
			success++
		} else if errors.Is(e, domain.ErrConflict) {
			conflicts++
		} else {
			t.Fatal(e)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatal(success, conflicts)
	}
	if v, err = r.Playback(ctx, other.ID); err != nil || v.TrackID != "" {
		t.Fatal("account bleed", v, err)
	}
	first.Position = 200
	v, err = r.SavePlayback(ctx, other.ID, first)
	if err != nil || v.Position != 100 {
		t.Fatal("duration clamp", v, err)
	}
	g, err := r.CreateGroup(ctx, "Restricted")
	if err != nil {
		t.Fatal(err)
	}
	if err = r.SetGroups(ctx, other.ID, []string{g.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err = r.CreateExclusion(ctx, domain.Exclusion{GroupID: g.ID, Kind: "track", Target: id}); err != nil {
		t.Fatal(err)
	}
	first.Sequence = 2
	if _, err = r.SavePlayback(ctx, other.ID, first); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("exclusion write", err)
	}
	var migrated bool
	if err = c.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=6)").Scan(&migrated); err != nil || !migrated {
		t.Fatal("migration", err)
	}
	if _, err = c.Exec(ctx, "DELETE FROM tracks WHERE id=$1", id); err != nil {
		t.Fatal(err)
	}
	if v, err = r.Playback(ctx, user.ID); err != nil || v.TrackID != "" {
		t.Fatal("deleted track", v, err)
	}
}
