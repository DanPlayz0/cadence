// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"cadence/internal/domain"
	"context"
	"testing"
	"time"
)

func TestSessionDevices(t *testing.T) {
	repo, conn := fixture(t)
	ctx := context.Background()
	user, err := repo.CreateUser(ctx, domain.User{Username: "devices", DisplayName: "Device User", Password: "hash"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if err = repo.SaveSession(ctx, "private-token", user.ID, "private-csrf", time.Now().Add(time.Hour), "hash"); err != nil {
		t.Fatal(err)
	}
	if err = repo.RecordDevice(ctx, "private-token", "Chrome/140.0", "0.1.0"); err != nil {
		t.Fatal(err)
	}
	devices, err := repo.Devices(ctx)
	if err != nil || len(devices) != 1 {
		t.Fatalf("devices: %v %v", devices, err)
	}
	first := devices[0]
	if first.ID == "private-token" || first.User.ID != user.ID || first.ClientVersion != "0.1.0" {
		t.Fatal("incorrect device details")
	}
	if err = repo.RecordDevice(ctx, "private-token", "Chrome/140.0", "0.1.0"); err != nil {
		t.Fatal(err)
	}
	devices, _ = repo.Devices(ctx)
	if len(devices) != 1 || !devices[0].LastActive.Equal(first.LastActive) {
		t.Fatal("repeated activity should be throttled and deduplicated")
	}
	if err = repo.RecordDevice(ctx, "private-token", "Chrome/141.0", "0.2.0"); err != nil {
		t.Fatal(err)
	}
	devices, _ = repo.Devices(ctx)
	if len(devices) != 1 || devices[0].ID != first.ID || devices[0].ClientVersion != "0.2.0" {
		t.Fatal("client updates should preserve record identity")
	}
	if err = repo.RecordDevice(ctx, "private-token", "Chrome/141.0", ""); err != nil {
		t.Fatal(err)
	}
	devices, _ = repo.Devices(ctx)
	if len(devices) != 1 || devices[0].ClientVersion != "0.2.0" {
		t.Fatal("requests without a version header must preserve the known client version")
	}
	if _, err = conn.Exec(ctx, "UPDATE sessions SET expires=now()-interval '1 second' WHERE token='private-token'"); err != nil {
		t.Fatal(err)
	}
	devices, _ = repo.Devices(ctx)
	if len(devices) != 0 {
		t.Fatal("expired sessions visible")
	}
	if err = repo.DeleteSession(ctx, "private-token"); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = conn.QueryRow(ctx, "SELECT count(*) FROM session_devices").Scan(&count); err != nil || count != 0 {
		t.Fatal("device record did not cascade on sign-out")
	}
}
