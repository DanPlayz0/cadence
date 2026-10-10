// SPDX-License-Identifier: GPL-2.0-or-later
//go:build !windows

package library

import "path/filepath"

func resolveCanonicalPath(path string) (string, error) { return filepath.EvalSymlinks(path) }
