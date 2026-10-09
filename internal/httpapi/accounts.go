// SPDX-License-Identifier: GPL-2.0-or-later
package httpapi

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"strings"

	"cadence/internal/domain"
	"golang.org/x/crypto/bcrypt"
)

func (s *Server) updateProfile(w http.ResponseWriter, r *http.Request) {
	var v struct {
		DisplayName string `json:"displayName"`
	}
	if !decode(w, r, &v) {
		return
	}
	if !validName(v.DisplayName) {
		write(w, 400, map[string]string{"error": "Use a display name up to 120 bytes."})
		return
	}
	u, err := s.Repo.UpdateUser(r.Context(), current(r).User.ID, domain.UserUpdate{DisplayName: &v.DisplayName})
	if err != nil {
		failure(w, err)
		return
	}
	write(w, 200, u)
}

func (s *Server) updateAdminUser(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Username    *string   `json:"username"`
		DisplayName *string   `json:"displayName"`
		Groups      *[]string `json:"groups"`
	}
	if !decode(w, r, &v) {
		return
	}
	if (v.Username == nil && v.DisplayName == nil && v.Groups == nil) || (v.Username != nil && !validName(*v.Username)) || (v.DisplayName != nil && !validName(*v.DisplayName)) || (v.Groups != nil && len(*v.Groups) > 100) {
		write(w, 400, map[string]string{"error": "Use valid names and at most 100 groups."})
		return
	}
	u, err := s.Repo.UpdateUser(r.Context(), r.PathValue("id"), domain.UserUpdate{Username: v.Username, DisplayName: v.DisplayName, Groups: v.Groups})
	if err != nil {
		failure(w, err)
		return
	}
	write(w, 200, u)
}

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	admin := strings.HasPrefix(r.URL.Path, "/api/v1/admin/")
	var password, proof string
	if admin {
		var v struct {
			Password string `json:"password"`
		}
		if !decode(w, r, &v) {
			return
		}
		password = v.Password
	} else {
		if !s.passwordLimiter.allow(r) {
			write(w, 429, map[string]string{"error": "Too many password attempts; try again later."})
			return
		}
		var v struct {
			Password        string `json:"password"`
			CurrentPassword string `json:"currentPassword"`
		}
		if !decode(w, r, &v) {
			return
		}
		password, proof = v.Password, v.CurrentPassword
	}
	if !validPassword(password) {
		write(w, 400, map[string]string{"error": "Use a password of at least 3 characters, up to 72 bytes."})
		return
	}
	id, expected, keep := r.PathValue("id"), "", ""
	if !admin {
		id = current(r).User.ID
		u, err := s.Repo.UserByID(r.Context(), id)
		if err != nil {
			failure(w, err)
			return
		}
		if len(proof) > 72 || bcrypt.CompareHashAndPassword([]byte(u.Password), []byte(proof)) != nil {
			write(w, 403, map[string]string{"error": "Current password is incorrect."})
			return
		}
		expected = u.Password
		cookie, _ := r.Cookie("cadence_session")
		keep = tokenHash(cookie.Value)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		failure(w, err)
		return
	}
	s.ok(w, s.Repo.ChangePassword(r.Context(), id, expected, string(hash), keep))
}

func (s *Server) updateAvatar(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		id = current(r).User.ID
	}
	var avatar []byte
	if r.Method != "DELETE" {
		r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
		data, err := io.ReadAll(r.Body)
		if err != nil {
			write(w, 413, map[string]string{"error": "Choose an image under 2 MiB."})
			return
		}
		avatar, err = normalizeAvatar(data)
		if err != nil {
			write(w, 400, map[string]string{"error": "Choose a valid JPEG or PNG, no larger than 4096 pixels per side or 8 million pixels."})
			return
		}
	}
	u, err := s.Repo.SetAvatar(r.Context(), id, avatar)
	if err != nil {
		failure(w, err)
		return
	}
	write(w, 200, u)
}

func normalizeAvatar(data []byte) ([]byte, error) {
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	if (format != "jpeg" && format != "png") || config.Width < 1 || config.Height < 1 || config.Width > 4096 || config.Height > 4096 || int64(config.Width)*int64(config.Height) > 8_000_000 {
		return nil, domain.ErrConflict
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	bounds := src.Bounds()
	side := min(bounds.Dx(), bounds.Dy())
	size := min(side, 256)
	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	ox, oy := bounds.Min.X+(bounds.Dx()-side)/2, bounds.Min.Y+(bounds.Dy()-side)/2
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			r, g, b, a := src.At(ox+x*side/size, oy+y*side/size).RGBA()
			dst.SetRGBA(x, y, color.RGBA{uint8((r + 32*257*(65535-a)/65535) >> 8), uint8((g + 37*257*(65535-a)/65535) >> 8), uint8((b + 28*257*(65535-a)/65535) >> 8), 255})
		}
	}
	var out bytes.Buffer
	if err = jpeg.Encode(&out, dst, &jpeg.Options{Quality: 85}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func (s *Server) userAvatar(w http.ResponseWriter, r *http.Request) {
	u := current(r).User
	if r.PathValue("id") != u.ID && !u.Admin {
		write(w, 403, map[string]string{"error": "Administrator required"})
		return
	}
	data, err := s.Repo.Avatar(r.Context(), r.PathValue("id"))
	if err != nil {
		failure(w, err)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	_, _ = w.Write(data)
}
