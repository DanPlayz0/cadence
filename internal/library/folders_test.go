// SPDX-License-Identifier: GPL-2.0-or-later
package library

import (
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

func TestResolveMusicDirectories(t *testing.T) {
	root := t.TempDir()
	child := filepath.Join(root, "Family")
	if e := os.Mkdir(child, 0700); e != nil {
		t.Fatal(e)
	}
	if _, e := ResolveDirectory([]string{root}, child); e != nil {
		t.Fatal(e)
	}
	for _, path := range []string{t.TempDir(), filepath.Join(root, "missing"), "relative", root + string(filepath.Separator) + ".." + string(filepath.Separator) + filepath.Base(root)} {
		if _, e := ResolveDirectory([]string{root}, path); e == nil {
			t.Fatalf("unsafe directory allowed: %s", path)
		}
	}
	link := filepath.Join(root, "escape")
	target := t.TempDir()
	linkErr := os.Symlink(target, link)
	if linkErr != nil && runtime.GOOS == "windows" {
		linkErr = exec.Command("cmd", "/c", "mklink", "/J", link, target).Run()
	}
	if e := linkErr; e != nil {
		t.Log("symlink creation unavailable:", e)
	} else if _, e = ResolveDirectory([]string{root}, link); e == nil {
		a, _ := Canonical(root)
		b, _ := Canonical(link)
		t.Fatalf("escaping symlink allowed: root=%s link=%s target=%s", a, b, target)
	}
	file := filepath.Join(root, "song.mp3")
	if e := os.WriteFile(file, []byte("x"), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e := ResolveDirectory([]string{root}, file); e == nil {
		t.Fatal("file accepted as directory")
	}
}
func TestMinimalLibraryFolders(t *testing.T) {
	got := MinimalFolders([]string{"/music/Family/Albums", "/music/FamilyOther", "/music/Family", "/music/Family"})
	want := []string{"/music/Family", "/music/FamilyOther"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("folders: %v", got)
	}
}
