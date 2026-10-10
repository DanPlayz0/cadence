// SPDX-License-Identifier: GPL-2.0-or-later
package soulseek

import (
	"cadence/internal/domain"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestPartialEnqueueRetryAndStagingCleanup(t *testing.T) {
	s, m, f, u, rule := setup(t)
	m.settings.Default = rule
	f.enqueueError = errors.New("partial enqueue")
	r, e := s.Create(context.Background(), u, ID(), "peer", "Music/Album", files())
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Tick(context.Background()); e != nil {
		t.Fatal(e)
	}
	r, _ = m.SoulseekRequest(context.Background(), r.ID)
	if r.State != "failed" || r.Files[0].TransferID != "" {
		t.Fatal("fixture failed", r)
	}
	old := r.BatchID
	os.MkdirAll(filepath.Join(s.Stage, old), 0750)
	os.WriteFile(filepath.Join(s.Stage, old, "song.mp3"), []byte("audio"), 0600)
	r, e = s.Action(context.Background(), u, r.ID, "retry", domain.SoulseekRule{})
	if e != nil || f.cancels != 1 || len(r.PreviousBatches) != 1 {
		t.Fatal("old transfer not cancelled", r, e)
	}
	f.enqueueError = nil
	os.MkdirAll(filepath.Join(s.Stage, r.BatchID), 0750)
	s.Action(context.Background(), u, r.ID, "cancel", domain.SoulseekRule{})
	s.Tick(context.Background())
	if _, e = s.Action(context.Background(), domain.User{Admin: true}, r.ID, "delete-staging", domain.SoulseekRule{}); e != nil {
		t.Fatal(e)
	}
	for _, id := range []string{old, r.BatchID} {
		if _, e = os.Stat(filepath.Join(s.Stage, id)); !os.IsNotExist(e) {
			t.Fatal("attempt staging retained", id)
		}
	}
}
