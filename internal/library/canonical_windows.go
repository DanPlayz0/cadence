// SPDX-License-Identifier: GPL-2.0-or-later
package library

import (
	"os"
	"strings"
	"syscall"
	"unsafe"
)

var getFinalPathName = syscall.NewLazyDLL("kernel32.dll").NewProc("GetFinalPathNameByHandleW")

// Resolve the opened object's final path, including junctions and directory mount
// points that filepath.EvalSymlinks can leave unresolved on Windows.
func resolveCanonicalPath(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	buffer := make([]uint16, 512)
	for {
		length, _, callErr := getFinalPathName.Call(file.Fd(), uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)), 0)
		if length == 0 {
			return "", os.NewSyscallError("GetFinalPathNameByHandleW", callErr)
		}
		if length >= uintptr(len(buffer)) {
			buffer = make([]uint16, length+1)
			continue
		}
		resolved := syscall.UTF16ToString(buffer[:length])
		if strings.HasPrefix(resolved, `\\?\UNC\`) {
			return `\\` + strings.TrimPrefix(resolved, `\\?\UNC\`), nil
		}
		return strings.TrimPrefix(resolved, `\\?\`), nil
	}
}
