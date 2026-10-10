// SPDX-License-Identifier: GPL-2.0-or-later
package domain

import (
	"context"
	"errors"
	"strings"
	"time"
)

var ErrNotFound = errors.New("not found")
var ErrConflict = errors.New("conflict")

type User struct {
	ID            string   `json:"id"`
	Username      string   `json:"username"`
	DisplayName   string   `json:"displayName"`
	Admin         bool     `json:"admin"`
	Password      string   `json:"-"`
	Groups        []string `json:"groups"`
	Avatar        bool     `json:"avatar"`
	AvatarVersion int64    `json:"avatarVersion"`
}

type UserUpdate struct {
	Username    *string
	DisplayName *string
	Groups      *[]string
}
type Session struct {
	User    User
	CSRF    string
	Expires time.Time
}

type Playback struct {
	TrackID  string  `json:"trackId"`
	Position float64 `json:"position"`
	Revision int64   `json:"revision"`
	Writer   string  `json:"writer"`
	Sequence int64   `json:"sequence"`
}
type Track struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Artist      string  `json:"artist"`
	AlbumArtist string  `json:"albumArtist,omitempty"`
	Album       string  `json:"album,omitempty"`
	AlbumID     string  `json:"albumId,omitempty"`
	Single      bool    `json:"single"`
	Number      int     `json:"number"`
	Disc        int     `json:"disc"`
	Year        string  `json:"year"`
	Genre       string  `json:"genre"`
	Duration    float64 `json:"duration"`
	Codec       string  `json:"codec"`
	MIME        string  `json:"mime"`
	Artwork     bool    `json:"artwork"`
	Liked       bool    `json:"liked"`
	Path        string  `json:"-"`
	ArtPath     string  `json:"-"`
	Size        int64   `json:"-"`
	Modified    int64   `json:"-"`
	Root        string  `json:"-"`
}

// NormalizeAlbum keeps singles distinct from albums without inventing album metadata.
func (t *Track) NormalizeAlbum() {
	t.Single = strings.TrimSpace(t.Album) == "" || strings.EqualFold(strings.TrimSpace(t.Album), "Unknown album")
	if t.Single {
		t.Album, t.AlbumID, t.AlbumArtist = "", "", ""
	}
}

type Page struct {
	Items  []Track `json:"items"`
	Total  int64   `json:"total"`
	Offset int     `json:"offset"`
	Limit  int     `json:"limit"`
}

type LibraryEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Kind    string `json:"kind"`
	TrackID string `json:"trackId,omitempty"`
	Title   string `json:"title,omitempty"`
	Artist  string `json:"artist,omitempty"`
	Tracks  int64  `json:"tracks"`
}
type LibraryDirectory struct {
	Items  []LibraryEntry `json:"items"`
	Total  int64          `json:"total"`
	Limit  int            `json:"limit"`
	Offset int            `json:"offset"`
}
type MetadataChoice struct {
	ID      string  `json:"id"`
	Current string  `json:"current"`
	Value   *string `json:"value,omitempty"`
}
type Query struct {
	Search, Album, Artist, Collection, Playlist string
	Offset, Limit                               int
}
type Album struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Artist  string `json:"artist"`
	Tracks  int    `json:"tracks"`
	CoverID string `json:"coverId"`
}
type ArtistLink struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}
type ArtistProfile struct {
	Name        string       `json:"name"`
	MBID        string       `json:"mbid"`
	Type        string       `json:"type"`
	Country     string       `json:"country"`
	Description string       `json:"description"`
	Biography   string       `json:"biography"`
	Image       string       `json:"image"`
	ImageSource string       `json:"imageSource"`
	Wikipedia   string       `json:"wikipedia"`
	Genres      []string     `json:"genres"`
	Links       []ArtistLink `json:"links"`
	Warning     string       `json:"warning"`
	Updated     time.Time    `json:"updated"`
}

type Artist struct {
	Name   string `json:"name"`
	Tracks int    `json:"tracks"`
}
type Playlist struct {
	Icon string `json:"icon"`
	ID   string `json:"id"`
	Name string `json:"name"`
}
type Group struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type Exclusion struct {
	ID      string `json:"id"`
	GroupID string `json:"groupId"`
	Kind    string `json:"kind"`
	Target  string `json:"target"`
}
type Suggestion struct {
	ID      string `json:"id"`
	TrackID string `json:"trackId"`
	Field   string `json:"field"`
	Value   string `json:"value"`
	Source  string `json:"source"`
	Status  string `json:"status"`
	Title   string `json:"title"`
	Current string `json:"current"`
}
type Scan struct {
	ID       string     `json:"id"`
	Started  time.Time  `json:"started"`
	Finished *time.Time `json:"finished"`
	Status   string     `json:"status"`
	Indexed  int        `json:"indexed"`
	Errors   []string   `json:"errors"`
}

// Interfaces contain domain values only; adapters own SQL and persistence details.
type AuthRepository interface {
	HasUsers(context.Context) (bool, error)
	CreateUser(context.Context, User, bool) (User, error)
	UserByUsername(context.Context, string) (User, error)
	UserByID(context.Context, string) (User, error)
	UpdateUser(context.Context, string, UserUpdate) (User, error)
	ChangePassword(context.Context, string, string, string, string) error
	Avatar(context.Context, string) ([]byte, error)
	SetAvatar(context.Context, string, []byte) (User, error)
	SaveSession(context.Context, string, string, string, time.Time, string) error
	Session(context.Context, string) (Session, error)
	DeleteSession(context.Context, string) error
	RevokeSessions(context.Context, string) error
}
type LibraryRepository interface {
	Tracks(context.Context, string, Query) (Page, error)
	Track(context.Context, string, string) (Track, error)
	AllowedIDs(context.Context, string, []string) ([]string, error)
	Albums(context.Context, string, string, string, int, int) ([]Album, error)
	LibraryDirectory(context.Context, string, string, int, int) (LibraryDirectory, error)
	Artists(context.Context, string, string, int, int) ([]Artist, error)
	UpsertTrack(context.Context, Track, string) (string, error)
	FileStamp(context.Context, string) (int64, int64, error)
	TrackByPath(context.Context, string) (Track, error)
	MarkSeen(context.Context, string, string) error
	FinishRoot(context.Context, string, string) error
	AddSuggestion(context.Context, Suggestion) error
	ScanStart(context.Context, Scan) error
	ScanFinish(context.Context, Scan) error
	Scans(context.Context) ([]Scan, error)
	RawTracks(context.Context, int, int) ([]Track, error)
	ArtistProfile(context.Context, string) (ArtistProfile, error)
	SaveArtistProfile(context.Context, string, ArtistProfile) error
}
type PersonalRepository interface {
	Playback(context.Context, string) (Playback, error)
	SavePlayback(context.Context, string, Playback) (Playback, error)
	Playlists(context.Context, string) ([]Playlist, error)
	CreatePlaylist(context.Context, string, string, string) (Playlist, error)
	DeletePlaylist(context.Context, string, string) error
	AddPlaylistTrack(context.Context, string, string, string) error
	RemovePlaylistTrack(context.Context, string, string, string) error
	Like(context.Context, string, string, bool) error
	RecordPlay(context.Context, string, string, string) error
}
type AdminRepository interface {
	Users(context.Context) ([]User, error)
	Groups(context.Context) ([]Group, error)
	CreateGroup(context.Context, string) (Group, error)
	SetGroups(context.Context, string, []string) error
	Exclusions(context.Context) ([]Exclusion, error)
	CreateExclusion(context.Context, Exclusion) (Exclusion, error)
	DeleteExclusion(context.Context, string) error
	Suggestions(context.Context, int, int) ([]Suggestion, error)
	TrackSuggestions(context.Context, string) ([]Suggestion, error)
	ApplyMetadataChoices(context.Context, string, []MetadataChoice) error
	Suggestion(context.Context, string) (Suggestion, error)
	ResolveSuggestion(context.Context, string, bool) error
	AcceptSuggestions(context.Context, []string) (int64, error)
	ClearOverride(context.Context, string, string) error
	Settings(context.Context) (map[string]bool, error)
	SetEnrichment(context.Context, bool) error
	InstanceName(context.Context) (string, error)
	SetInstanceName(context.Context, string) error
}
type Repository interface {
	AuthRepository
	LibraryRepository
	PersonalRepository
	AdminRepository
	Ping(context.Context) error
	Close()
}
