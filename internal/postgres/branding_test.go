// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"context"
	"testing"
)

func TestInstanceNamePersistence(t *testing.T) {
	repo, conn := fixture(t)
	ctx := context.Background()
	if name, err := repo.InstanceName(ctx); err != nil || name != "Cadence" {
		t.Fatalf("default name: %q %v", name, err)
	}
	if err := repo.SetInstanceName(ctx, "Friends' 音楽"); err != nil {
		t.Fatal(err)
	}
	var saved string
	if err := conn.QueryRow(ctx, "SELECT value FROM instance_settings WHERE key='name'").Scan(&saved); err != nil || saved != "Friends' 音楽" {
		t.Fatalf("stored name: %q %v", saved, err)
	}
}
