// SPDX-License-Identifier: GPL-2.0-or-later
package domain

import "testing"

func TestLosslessCodec(t *testing.T) {
	for _, codec := range []string{"flac", "FLAC", "alac", "pcm_s16le", "pcm_s24be", "pcm_u8", "pcm_f32le"} {
		if !LosslessCodec(codec) {
			t.Errorf("lossless codec rejected: %s", codec)
		}
	}
	for _, codec := range []string{"mp3", "aac", "adpcm_ms", "pcm_alaw", "pcm_mulaw", "", "wav", "pcm_unknown"} {
		if LosslessCodec(codec) {
			t.Errorf("non-lossless codec accepted: %s", codec)
		}
	}
}
