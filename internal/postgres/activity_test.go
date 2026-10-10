// SPDX-License-Identifier: GPL-2.0-or-later
package postgres_test

import (
	"cadence/internal/domain"
	"context"
	"strings"
	"testing"
	"time"
)

func TestActivityEventsAndPersistence(t *testing.T) {
	repo, conn := fixture(t)
	ctx := context.Background()
	user, err := repo.CreateUser(ctx, domain.User{Username: "activity", DisplayName: "Activity User", Password: "private-password"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if err = repo.SaveSession(ctx, "private-token", user.ID, "private-csrf", time.Now().Add(time.Hour), user.Password); err != nil {
		t.Fatal(err)
	}
	if err = repo.RecordDevice(ctx, "private-token", "Chrome/140", "0.1.0"); err != nil {
		t.Fatal(err)
	}
	if err = repo.RecordDevice(ctx, "private-token", "Chrome/140", "0.1.0"); err != nil {
		t.Fatal(err)
	}
	if err = repo.SetInstanceName(ctx, "Activity Server"); err != nil {
		t.Fatal(err)
	}
	if err = repo.SetEnrichment(ctx, true); err != nil {
		t.Fatal(err)
	}
	if err = repo.DeleteSession(ctx, "private-token"); err != nil {
		t.Fatal(err)
	}
	scan := domain.Scan{ID: "scan", Started: time.Now(), Status: "running"}
	if err = repo.ScanStart(ctx, scan); err != nil {
		t.Fatal(err)
	}
	finished := time.Now()
	scan.Finished = &finished
	scan.Status = "completed"
	scan.Indexed = 5
	scan.Errors = []string{"reported issue"}
	if err = repo.ScanFinish(ctx, scan); err != nil {
		t.Fatal(err)
	}
	cleanScan := domain.Scan{ID: "clean-scan", Started: time.Now(), Status: "running"}
	if err = repo.ScanStart(ctx, cleanScan); err != nil {
		t.Fatal(err)
	}
	cleanScan.Status = "completed"
	cleanScan.Finished = &finished
	if err = repo.ScanFinish(ctx, cleanScan); err != nil {
		t.Fatal(err)
	}
	trackID, err := repo.UpsertTrack(ctx, domain.Track{Path: "/music/activity.mp3", Root: "/music", Title: "Test Song", Artist: "Test Artist"}, "scan")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err = repo.RecordPlay(ctx, user.ID, trackID, "same-play-event"); err != nil {
			t.Fatal(err)
		}
	}
	group, err := repo.CreateGroup(ctx, "Activity Group")
	if err != nil {
		t.Fatal(err)
	}
	if err = repo.SetGroups(ctx, user.ID, []string{group.ID}); err != nil {
		t.Fatal(err)
	}
	if err = repo.RecordActivity(ctx, domain.ActivityEntry{Level: "Warning", UserID: user.ID, UserName: user.DisplayName, Name: "Sign-in failed", Overview: "Invalid username or password", Type: "AuthenticationFailed"}); err != nil {
		t.Fatal(err)
	}
	page, err := repo.Activity(ctx, "all", "", 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	types := map[string]int{}
	for _, entry := range page.Items {
		types[entry.Type]++
		for _, secret := range []string{"private-password", "private-token", "private-csrf"} {
			if strings.Contains(entry.Name+entry.Overview, secret) {
				t.Fatal("activity contains credentials")
			}
		}
		if entry.Type == "ScanCompleted" && strings.Contains(entry.Overview, "1 reported issues") && entry.Level != "Warning" {
			t.Fatal("scan issues should produce a warning")
		}
	}
	for _, kind := range []string{"UserCreated", "SessionStarted", "SessionEnded", "BrandingChanged", "SettingsChanged", "AudioPlayed", "GroupCreated", "UserGroupsChanged", "AuthenticationFailed"} {
		if types[kind] != 1 {
			t.Fatalf("event %s count %d", kind, types[kind])
		}
	}
	if types["ScanStarted"] != 2 || types["ScanCompleted"] != 2 {
		t.Fatal("scan events missing")
	}
	users, err := repo.Activity(ctx, "user", "", 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range users.Items {
		if entry.UserID == "" {
			t.Fatal("system event in user filter")
		}
	}
	system, err := repo.Activity(ctx, "system", "", 100, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range system.Items {
		if entry.UserID != "" {
			t.Fatal("user event in system filter")
		}
	}
	matches, err := repo.Activity(ctx, "all", "activity server", 25, 0)
	if err != nil || matches.Total != 1 {
		t.Fatalf("search mismatch: %v %v", matches, err)
	}
	second, err := repo.Activity(ctx, "all", "", 1, 1)
	if err != nil || len(second.Items) != 1 || second.Total != page.Total || second.Items[0].ID != page.Items[1].ID {
		t.Fatal("pagination mismatch")
	}
	if _, err = conn.Exec(ctx, "DELETE FROM users WHERE id=$1", user.ID); err != nil {
		t.Fatal(err)
	}
	retained, err := repo.Activity(ctx, "user", "signed in", 25, 0)
	if err != nil || retained.Total != 1 || retained.Items[0].UserName != "Activity User" {
		t.Fatal("user deletion erased activity")
	}
}
