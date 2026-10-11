// SPDX-License-Identifier: GPL-2.0-or-later
package domain

import (
	"regexp"
	"strings"
)

var uncompressedPCM = regexp.MustCompile(`^pcm_((s|u)(8|16|24|32|64)(le|be)?|f(32|64)(le|be))$`)

// LosslessCodec classifies decoded codecs, not containers or file extensions.
func LosslessCodec(codec string) bool {
	codec = strings.ToLower(codec)
	return codec == "flac" || codec == "alac" || uncompressedPCM.MatchString(codec)
}
