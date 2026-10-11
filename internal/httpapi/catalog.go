// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"cadence/internal/library"
	"errors"
	"net/http"
	"regexp"
	"strings"
)

var catalogID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func (s *Server) catalog(w http.ResponseWriter, r *http.Request) {
	kind, query, id := r.URL.Query().Get("type"), strings.TrimSpace(r.URL.Query().Get("q")), r.PathValue("id")
	if id == "" && (kind != "artist" && kind != "album" && kind != "song" || len(query) < 3 || len(query) > 200) {
		write(w, 400, map[string]string{"error": "Choose artist, album, or song and a query between 3 and 200 bytes"})
		return
	}
	if id != "" && !catalogID.MatchString(id) {
		write(w, 400, map[string]string{"error": "Invalid catalog ID"})
		return
	}
	if s.Scanner == nil || s.Scanner.Enricher == nil {
		write(w, 503, map[string]string{"error": library.ErrCatalogUnavailable.Error()})
		return
	}
	limit, offset := pagination(r)
	if limit > 100 {
		limit = 100
	}
	var out any
	var err error
	switch {
	case strings.HasSuffix(r.URL.Path, "/albums"):
		out, err = s.Scanner.Enricher.CatalogArtistAlbums(r.Context(), id, limit, offset)
	case id != "":
		out, err = s.Scanner.Enricher.CatalogAlbum(r.Context(), id)
	default:
		out, err = s.Scanner.Enricher.CatalogSearch(r.Context(), kind, query, limit, offset)
	}
	if err != nil {
		status := 502
		if errors.Is(err, library.ErrCatalogUnavailable) {
			status = 503
		}
		write(w, status, map[string]string{"error": err.Error()})
		return
	}
	write(w, 200, out)
}
