// SPDX-License-Identifier: GPL-2.0-or-later
package soulseek

import (
	"context"
	"errors"
	"os"
	"testing"
)

// Run against an isolated slskd 0.26.0 container with NO_CONNECT=true and a
// writable /smoke-music directory. No Soulseek credentials or peers are needed.
func TestSlskdContainerSmoke(t *testing.T) {
	base := os.Getenv("TEST_SLSKD_URL")
	if base == "" {
		t.Skip("set TEST_SLSKD_URL for the isolated container smoke test")
	}
	client := NewClient(base, os.Getenv("TEST_SLSKD_API_KEY"), os.Getenv("TEST_SLSKD_USERNAME"), os.Getenv("TEST_SLSKD_PASSWORD"))
	ctx := context.Background()
	_, e := client.Batch(ctx, ID())
	var apiError *APIError
	if !errors.As(e, &apiError) || apiError.Status != 404 {
		t.Fatal("batch contract", e)
	}
	if e = client.SyncShares(ctx, nil, []string{"[Cadence-smoke]/smoke-music"}); e != nil {
		t.Fatal("sharing API", e)
	}
	if e = client.SyncShares(ctx, []string{"[Cadence-smoke]/smoke-music"}, nil); e != nil {
		t.Fatal("sharing removal", e)
	}
}
