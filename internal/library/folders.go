// SPDX-License-Identifier: GPL-2.0-or-later
package library

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ResolveDirectory is shared by setup, scanning and media access validation.
func ResolveDirectory(roots []string, path string) (string, error) {
	for _, part := range strings.Split(strings.ReplaceAll(path, `\`, "/"), "/") {
		if part == ".." {
			return "", errors.New("parent traversal is not allowed")
		}
	}
	if !filepath.IsAbs(filepath.FromSlash(path)) {
		return "", errors.New("choose an absolute directory")
	}
	p, err := Canonical(path)
	if err != nil {
		return "", err
	}
	for _, r := range roots {
		root, e := Canonical(r)
		if e == nil && Within(root, p) {
			info, e := os.Stat(p)
			if e == nil && info.IsDir() {
				return p, nil
			}
		}
	}
	return "", errors.New("directory outside mounted music roots or unavailable")
}

// MinimalFolders avoids walking the same subtree more than once.
func MinimalFolders(paths []string) []string {
	paths = append([]string(nil), paths...)
	sort.Slice(paths, func(i, j int) bool {
		if len(paths[i]) != len(paths[j]) {
			return len(paths[i]) < len(paths[j])
		}
		return paths[i] < paths[j]
	})
	out := []string{}
	for _, p := range paths {
		covered := false
		for _, parent := range out {
			if Within(parent, p) {
				covered = true
				break
			}
		}
		if !covered {
			out = append(out, p)
		}
	}
	sort.Strings(out)
	return out
}
