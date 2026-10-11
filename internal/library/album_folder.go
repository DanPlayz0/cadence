// SPDX-License-Identifier: GPL-2.0-or-later
package library

import (
	"encoding/xml"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"cadence/internal/domain"
)

type folderAlbum struct {
	XMLName     xml.Name `xml:"album"`
	Title       string   `xml:"title"`
	AlbumArtist string   `xml:"albumartist"`
	Artists     []string `xml:"artist"`
	Year        string   `xml:"year"`
	Genres      []string `xml:"genre"`
}

var folderYear = regexp.MustCompile(`^(.*?)\s*\((\d{4})\)$`)
var folderTrackNumber = regexp.MustCompile(`^(?:(\d+)-)?(\d+)[ ._-]+(.+)$`)

// Local release sidecars identify album folders without treating every music
// directory as an album. NFO contents are optional (scene releases use text).
func readFolderAlbum(dir string) folderAlbum {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return folderAlbum{}
	}
	var nfos []string
	cover, audio := false, 0
	for _, entry := range entries {
		if !entry.Type().IsRegular() {
			continue
		}
		name := strings.ToLower(entry.Name())
		if filepath.Ext(name) == ".nfo" {
			path := filepath.Join(dir, entry.Name())
			if name == "album.nfo" {
				nfos = append([]string{path}, nfos...)
			} else {
				nfos = append(nfos, path)
			}
		}
		if name == "cover.jpg" || name == "cover.png" || name == "folder.jpg" || name == "folder.png" || name == "front.jpg" {
			cover = true
		}
		if _, ok := extensions[filepath.Ext(name)]; ok {
			audio++
		}
	}
	if len(nfos) == 0 && !(cover && audio > 1) {
		return folderAlbum{}
	}
	var album folderAlbum
	for _, path := range nfos {
		file, err := os.Open(path)
		if err != nil {
			continue
		}
		var candidate folderAlbum
		err = xml.NewDecoder(io.LimitReader(file, 1<<20)).Decode(&candidate)
		file.Close()
		if err == nil {
			album = candidate
			break
		}
	}
	album.Title = strings.TrimSpace(album.Title)
	album.AlbumArtist = strings.TrimSpace(album.AlbumArtist)
	album.Year = strings.TrimSpace(album.Year)
	if album.Title == "" {
		album.Title = filepath.Base(dir)
		if match := folderYear.FindStringSubmatch(album.Title); match != nil {
			album.Title = strings.TrimSpace(match[1])
			if album.Year == "" {
				album.Year = match[2]
			}
		}
	}
	if album.AlbumArtist == "" && len(album.Artists) == 1 {
		album.AlbumArtist = strings.TrimSpace(album.Artists[0])
	}
	if album.AlbumArtist == "" {
		album.AlbumArtist = filepath.Base(filepath.Dir(dir))
	}
	return album
}

// Embedded tags take precedence; folder values supply absent release metadata.
func (a folderAlbum) apply(t *domain.Track, tags map[string]string) {
	if a.Title == "" {
		return
	}
	if strings.TrimSpace(t.Album) == "" || strings.EqualFold(strings.TrimSpace(t.Album), "Unknown album") {
		t.Album = a.Title
	}
	if strings.TrimSpace(tags["album_artist"]) == "" && strings.TrimSpace(tags["albumartist"]) == "" {
		t.AlbumArtist = a.AlbumArtist
	}
	if strings.TrimSpace(tags["artist"]) == "" {
		t.Artist = a.AlbumArtist
	}
	if t.Year == "" {
		t.Year = a.Year
	}
	if t.Genre == "" {
		t.Genre = strings.Join(a.Genres, " / ")
	}
	stem := strings.TrimSuffix(filepath.Base(t.Path), filepath.Ext(t.Path))
	if match := folderTrackNumber.FindStringSubmatch(stem); match != nil {
		if tags["title"] == "" {
			t.Title, _, _ = FilenameMetadata(match[3] + filepath.Ext(t.Path))
		}
		if t.Number == 0 {
			t.Number, _ = strconv.Atoi(match[2])
		}
		if t.Disc == 0 && match[1] != "" {
			t.Disc, _ = strconv.Atoi(match[1])
		}
	}
}
