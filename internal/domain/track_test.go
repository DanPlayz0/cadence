// SPDX-License-Identifier: GPL-2.0-or-later
package domain

import (
	"encoding/json"
	"testing"
)

func TestSingleMetadata(t *testing.T) {
	for _, album := range []string{"", "  ", "Unknown album"} {
		track := Track{Album: album, AlbumID: "old", AlbumArtist: "Artist"}
		track.NormalizeAlbum()
		data, err := json.Marshal(track)
		if err != nil {
			t.Fatal(err)
		}
		var fields map[string]any
		if err = json.Unmarshal(data, &fields); err != nil {
			t.Fatal(err)
		}
		if fields["single"] != true {
			t.Fatalf("missing single classification: %s", data)
		}
		for _, field := range []string{"album", "albumId", "albumArtist"} {
			if _, exists := fields[field]; exists {
				t.Fatalf("single includes %s: %s", field, data)
			}
		}
	}
	track := Track{Album: "Real album", AlbumID: "id", AlbumArtist: "Artist"}
	track.NormalizeAlbum()
	if track.Single || track.AlbumID != "id" {
		t.Fatal("album changed", track)
	}
}
