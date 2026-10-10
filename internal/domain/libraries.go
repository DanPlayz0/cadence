// SPDX-License-Identifier: GPL-2.0-or-later
package domain

import "context"

// MusicLibrary is administrator configuration. Listener responses expose only ID and Name.
type MusicLibrary struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Folders  []string `json:"folders"`
	Everyone bool     `json:"everyone"`
	Users    []string `json:"users"`
	Groups   []string `json:"groups"`
}

type LibrarySummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type NamedLibraryRepository interface {
	MusicLibraries(context.Context) ([]MusicLibrary, error)
	AccessibleLibraries(context.Context, string) ([]LibrarySummary, error)
	SaveMusicLibrary(context.Context, MusicLibrary) (MusicLibrary, error)
	DeleteMusicLibrary(context.Context, string) error
	InitializeLibraries(context.Context, []string) error
	FinishFolder(context.Context, string, string) error
	AlbumsInLibrary(context.Context, string, string, string, string, int, int) ([]Album, error)
	ArtistsInLibrary(context.Context, string, string, string, int, int) ([]Artist, error)
}
