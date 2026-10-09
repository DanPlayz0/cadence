// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"bytes"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"testing"
)

func TestNormalizeAvatar(t *testing.T) {
	for _, format := range []string{"png", "jpeg"} {
		var input bytes.Buffer
		src := image.NewRGBA(image.Rect(0, 0, 700, 400))
		if format == "png" {
			png.Encode(&input, src)
		} else {
			jpeg.Encode(&input, src, nil)
		}
		output, err := normalizeAvatar(input.Bytes())
		if err != nil {
			t.Fatal(err)
		}
		config, kind, err := image.DecodeConfig(bytes.NewReader(output))
		if err != nil || kind != "jpeg" || config.Width != 256 || config.Height != 256 {
			t.Fatalf("unexpected normalized image: %v %s %v", config, kind, err)
		}
		if len(output) > 524288 {
			t.Fatal("avatar exceeds storage bound")
		}
	}
	var gifData, oversized bytes.Buffer
	gif.Encode(&gifData, image.NewRGBA(image.Rect(0, 0, 2, 2)), nil)
	png.Encode(&oversized, image.NewRGBA(image.Rect(0, 0, 4097, 1)))
	for _, data := range [][]byte{nil, []byte("<svg></svg>"), gifData.Bytes(), oversized.Bytes()} {
		if _, err := normalizeAvatar(data); err == nil {
			t.Fatal("invalid or oversized avatar accepted")
		}
	}
}
