// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"cadence/internal/domain"
	"cadence/internal/library"
)

func (s *Server) namedLibraries(w http.ResponseWriter) (domain.NamedLibraryRepository, bool) {
	repo, ok := s.Repo.(domain.NamedLibraryRepository)
	if !ok {
		write(w, 501, map[string]string{"error": "Library configuration unavailable"})
	}
	return repo, ok
}
func (s *Server) musicLibraries(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.namedLibraries(w)
	if !ok {
		return
	}
	v, e := repo.MusicLibraries(r.Context())
	if e != nil {
		failure(w, e)
		return
	}
	write(w, 200, v)
}
func (s *Server) accessibleLibraries(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.namedLibraries(w)
	if !ok {
		return
	}
	v, e := repo.AccessibleLibraries(r.Context(), current(r).User.ID)
	if e != nil {
		failure(w, e)
		return
	}
	write(w, 200, v)
}
func (s *Server) saveMusicLibrary(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.namedLibraries(w)
	if !ok {
		return
	}
	var input struct {
		Name     string   `json:"name"`
		Folders  []string `json:"folders"`
		Everyone bool     `json:"everyone"`
		Users    []string `json:"users"`
		Groups   []string `json:"groups"`
	}
	if !decode(w, r, &input) {
		return
	}
	if !validName(input.Name) || len(input.Folders) == 0 || len(input.Folders) > 100 || len(input.Users) > 10000 || len(input.Groups) > 10000 {
		write(w, 400, map[string]string{"error": "Choose a name and between one and 100 music folders"})
		return
	}
	folders := []string{}
	var previous *domain.MusicLibrary
	if id := r.PathValue("id"); id != "" {
		libraries, e := repo.MusicLibraries(r.Context())
		if e != nil {
			failure(w, e)
			return
		}
		for i := range libraries {
			if libraries[i].ID == id {
				previous = &libraries[i]
				break
			}
		}
		if previous == nil {
			failure(w, domain.ErrNotFound)
			return
		}
	}
	for _, p := range input.Folders {
		resolved, e := library.ResolveDirectory(s.Config.Roots, p)
		// Retaining a temporarily missing directory must not prevent revoking sharing.
		// Newly selected folders still have to exist, and scans revalidate every path.
		if e != nil && errors.Is(e, os.ErrNotExist) && previous != nil {
			retainedPath := filepath.ToSlash(filepath.Clean(p))
			retained := false
			for _, old := range previous.Folders {
				if retainedPath == old {
					retained = true
					break
				}
			}
			if retained {
				for _, root := range s.Config.Roots {
					if library.Within(root, retainedPath) {
						resolved, e = retainedPath, nil
						break
					}
				}
			}
		}
		if e != nil {
			write(w, 400, map[string]string{"error": "Each folder must exist inside a mounted music root"})
			return
		}
		folders = append(folders, resolved)
	}
	v := domain.MusicLibrary{ID: r.PathValue("id"), Name: strings.TrimSpace(input.Name), Folders: library.MinimalFolders(folders), Everyone: input.Everyone, Users: input.Users, Groups: input.Groups}
	v, e := repo.SaveMusicLibrary(r.Context(), v)
	if e != nil {
		failure(w, e)
		return
	}
	changedFolders := previous == nil || len(previous.Folders) != len(v.Folders)
	if !changedFolders {
		for i, p := range v.Folders {
			if previous.Folders[i] != p {
				changedFolders = true
				break
			}
		}
	}
	if s.Scanner != nil && changedFolders {
		s.Scanner.RequestScan()
	}
	status := 200
	if r.Method == "POST" {
		status = 201
	}
	write(w, status, v)
}
func (s *Server) deleteMusicLibrary(w http.ResponseWriter, r *http.Request) {
	repo, ok := s.namedLibraries(w)
	if !ok {
		return
	}
	if e := repo.DeleteMusicLibrary(r.Context(), r.PathValue("id")); e != nil {
		failure(w, e)
		return
	}
	if s.Scanner != nil {
		s.Scanner.RequestScan()
	}
	write(w, 200, map[string]bool{"deleted": true})
}

type diskFolder struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

func (s *Server) musicFolders(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	path := r.URL.Query().Get("path")
	out := []diskFolder{}
	parent := ""
	if path == "" {
		for _, root := range s.Config.Roots {
			out = append(out, diskFolder{Name: filepath.Base(filepath.FromSlash(root)), Path: root})
		}
	} else {
		resolved, e := library.ResolveDirectory(s.Config.Roots, path)
		if e != nil {
			write(w, 400, map[string]string{"error": "Folder unavailable or outside mounted music roots"})
			return
		}
		path = resolved
		p := filepath.Dir(filepath.FromSlash(path))
		if resolvedParent, e := library.ResolveDirectory(s.Config.Roots, p); e == nil && resolvedParent != path {
			parent = resolvedParent
		}
		f, e := os.Open(filepath.FromSlash(path))
		if e != nil {
			write(w, 400, map[string]string{"error": "Unable to read folder"})
			return
		}
		defer f.Close()
		// Enumerate only this directory; never recursively walk a broad mount in the picker.
		entries, e := f.ReadDir(-1)
		if e != nil {
			write(w, 400, map[string]string{"error": "Unable to read folder"})
			return
		}
		for _, entry := range entries {
			if !entry.IsDir() && entry.Type()&os.ModeSymlink == 0 {
				continue
			}
			child := filepath.Join(filepath.FromSlash(path), entry.Name())
			if p, e := library.ResolveDirectory(s.Config.Roots, child); e == nil {
				out = append(out, diskFolder{Name: entry.Name(), Path: p})
			}
		}
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := strings.ToLower(out[i].Name), strings.ToLower(out[j].Name)
		if a != b {
			return a < b
		}
		return out[i].Path < out[j].Path
	})
	total := len(out)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	write(w, 200, map[string]any{"path": path, "parent": parent, "items": out[offset:end], "total": total, "limit": limit, "offset": offset})
}
