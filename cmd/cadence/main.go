// SPDX-License-Identifier: GPL-2.0-or-later
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"cadence/internal/httpapi"
	"cadence/internal/library"
	"cadence/internal/media"
	"cadence/internal/postgres"
	"cadence/internal/scrobble"
	"cadence/internal/soulseek"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func number(key string, fallback int) int {
	v, e := strconv.Atoi(os.Getenv(key))
	if e != nil || v < 1 {
		return fallback
	}
	return v
}
func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
func run() error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return fmt.Errorf("DATABASE_URL is required (PostgreSQL)")
	}
	public := strings.TrimRight(os.Getenv("PUBLIC_URL"), "/")
	if err := httpapi.ValidatePublicURL(public); err != nil {
		return err
	}
	publicURLs, err := httpapi.ParsePublicURLs(os.Getenv("PUBLIC_URLS"))
	if err != nil {
		return err
	}
	allowAnyOrigin, err := strconv.ParseBool(env("ALLOW_ANY_ORIGIN", "false"))
	if err != nil {
		return fmt.Errorf("ALLOW_ANY_ORIGIN must be a boolean: %w", err)
	}
	data := env("DATA_DIR", "./.local/data")
	art := filepath.Join(data, "artwork")
	if err := os.MkdirAll(art, 0750); err != nil {
		return err
	}
	openCtx, openCancel := context.WithTimeout(ctx, 30*time.Second)
	repo, err := postgres.Open(openCtx, dbURL)
	openCancel()
	if err != nil {
		return err
	}
	defer repo.Close()
	roots := strings.Split(env("MUSIC_ROOTS", "/music"), ";")
	for i := range roots {
		roots[i] = strings.TrimSpace(roots[i])
		if roots[i] == "" {
			return fmt.Errorf("empty MUSIC_ROOTS entry")
		}
	}
	// Store normalized paths even when a mount is temporarily unavailable.
	for i, r := range roots {
		p, e := library.Canonical(r)
		if e != nil {
			p, e = filepath.Abs(r)
			if e != nil {
				return e
			}
			p = filepath.ToSlash(filepath.Clean(p))
		}
		roots[i] = p
	}
	if err = repo.InitializeLibraries(ctx, roots); err != nil {
		return err
	}
	cache, err := media.New(filepath.Join(data, "transcodes"), int64(number("TRANSCODE_CACHE_MB", 2048))<<20, number("TRANSCODE_WORKERS", 2), ctx)
	if err != nil {
		return err
	}
	enricher := &library.Enricher{Repo: repo, ArtDir: art, UserAgent: os.Getenv("METADATA_USER_AGENT")}
	scanner := &library.Scanner{Repo: repo, Roots: roots, ManagedLibraries: true, ArtDir: art, Enricher: enricher, Context: ctx}
	stage := os.Getenv("SOULSEEK_STAGING_DIR")
	writable := []string{}
	for _, p := range strings.Split(os.Getenv("SOULSEEK_WRITABLE_ROOTS"), ";") {
		if strings.TrimSpace(p) != "" {
			writable = append(writable, strings.TrimSpace(p))
		}
	}
	remote := soulseek.NewClient(os.Getenv("SLSKD_URL"), os.Getenv("SLSKD_API_KEY"), env("SLSKD_USERNAME", "cadence"), os.Getenv("SLSKD_PASSWORD"))
	soul := &soulseek.Service{Repo: repo, Libraries: repo, Activity: repo.RecordActivity, Remote: remote, Configured: remote.Configured() && stage != "", Roots: roots, WritableRoots: writable, Stage: stage, Scan: scanner.RequestScan}
	if stage != "" {
		p, e := library.Canonical(stage)
		if e != nil {
			p, e = filepath.Abs(stage)
		}
		if e != nil {
			return e
		}
		scanner.ExcludedRoots = []string{filepath.ToSlash(p)}
	}
	app := &httpapi.Server{Repo: repo, Scanner: scanner, Cache: cache, Config: httpapi.Config{PublicURL: public, PublicURLs: publicURLs, WebDir: env("WEB_DIR", "web/dist"), ArtDir: art, Roots: roots, SecureCookie: strings.HasPrefix(public, "https://"), AllowAnyOrigin: allowAnyOrigin}}
	app.Soulseek = soul
	syncService, err := scrobble.New(repo, repo, scrobble.NewProviders(os.Getenv("LASTFM_API_KEY"), os.Getenv("LASTFM_API_SECRET")), data)
	if err != nil {
		return fmt.Errorf("initialize sync: %w", err)
	}
	app.Sync = syncService
	go syncService.Run(ctx)
	go soul.Run(ctx)
	server := &http.Server{Addr: env("LISTEN_ADDR", ":8080"), Handler: app.Handler(), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 32 << 10}
	go func() {
		ticker := time.NewTicker(time.Duration(number("SCAN_INTERVAL_MINUTES", 60)) * time.Minute)
		defer ticker.Stop()
		scanner.Start(false)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				scanner.Start(false)
			}
		}
	}()
	go func() {
		<-ctx.Done()
		stop, done := context.WithTimeout(context.Background(), 15*time.Second)
		defer done()
		_ = server.Shutdown(stop)
	}()
	slog.Info("Cadence listening", "address", server.Addr)
	err = server.ListenAndServe()
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}
