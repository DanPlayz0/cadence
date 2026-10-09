// SPDX-License-Identifier: GPL-2.0-or-later
package library

import "testing"

func TestFilenameMetadata(t *testing.T) {
	for _, v := range []struct{ file, title, artist, album string }{
		{"Coldplay - Yellow (Official Video) [yKNxeF4KMsY].mp3", "Yellow", "Coldplay", ""},
		{"Adele - Someone Like You (Official Music Video).mp3", "Someone Like You", "Adele", ""},
		{"Evanescence - Bring Me To Life (Official HD Music Video) ft. Paul McCoy [3YxaaGgTQYM].mp3", "Bring Me To Life ft. Paul McCoy", "Evanescence", ""},
		{"In The End [Official HD Music Video] - Linkin Park [eVTXPUF4Oz4].mp3", "In The End", "Linkin Park", ""},
		{"Numb (Official Music Video) [4K UPGRADE] – Linkin Park [kXYiU_JCYtU].mp3", "Numb", "Linkin Park", ""},
		{"The Middle Lyrics (From Supergirl) Kelty Greye, KidMotel [g9ttrhMJgMU].mp3", "The Middle Lyrics", "Kelty Greye, KidMotel", "Supergirl"},
		{"Eurythmics - Sweet Dreams (Are Made Of This) (Official Video).mp3", "Sweet Dreams (Are Made Of This)", "Eurythmics", ""},
		{"Gym Class Heroes： Stereo Hearts ft. Adam Levine [OFFICIAL VIDEO] [T3E9Wjbq44E].mp3", "Stereo Hearts ft. Adam Levine", "Gym Class Heroes", ""},
		{"Northern Attitude - the piano version [SzJjK0Bi1Fg].mp3", "Northern Attitude - the piano version", "", ""},
		{"Billionaire (feat. Bruno Mars) [NAHO25MmpYc].mp3", "Billionaire (feat. Bruno Mars)", "", ""},
		{"01-音.wav", "01-音", "", ""},
		{"Song [not an ID].mp3", "Song [not an ID]", "", ""},
	} {
		title, artist, album := FilenameMetadata(v.file)
		if title != v.title || artist != v.artist || album != v.album {
			t.Errorf("%s: got %q / %q / %q", v.file, title, artist, album)
		}
	}
}
