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
	cache, err := media.New(filepath.Join(data, "transcodes"), int64(number("TRANSCODE_CACHE_MB", 2048))<<20, number("TRANSCODE_WORKERS", 2), ctx)
	if err != nil {
		return err
	}
	enricher := &library.Enricher{Repo: repo, ArtDir: art, UserAgent: os.Getenv("METADATA_USER_AGENT")}
	scanner := &library.Scanner{Repo: repo, Roots: roots, ArtDir: art, Enricher: enricher, Context: ctx}
	app := &httpapi.Server{Repo: repo, Scanner: scanner, Cache: cache, Config: httpapi.Config{PublicURL: public, WebDir: env("WEB_DIR", "web/dist"), ArtDir: art, Roots: roots, SecureCookie: strings.HasPrefix(public, "https://")}}
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
