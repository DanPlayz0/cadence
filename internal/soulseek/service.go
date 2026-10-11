// SPDX-License-Identifier: GPL-2.0-or-later
package soulseek

import (
	"cadence/internal/domain"
	"cadence/internal/library"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

var uuidPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)

func ValidID(id string) bool { return uuidPattern.MatchString(id) }
func ID() string {
	var b [16]byte
	if _, e := rand.Read(b[:]); e != nil {
		panic(e)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	h := hex.EncodeToString(b[:])
	return h[:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

type Service struct {
	Repo                 domain.SoulseekRepository
	Libraries            domain.NamedLibraryRepository
	Activity             func(context.Context, domain.ActivityEntry) error
	Remote               Remote
	Configured           bool
	Roots, WritableRoots []string
	Stage                string
	Scan                 func()
	ValidateAudio        func(context.Context, *os.File) error
	mu                   sync.Mutex
	jobs                 [64]sync.Mutex
}

func (s *Service) requestLock(id string) func() {
	h := sha256.Sum256([]byte(id))
	m := &s.jobs[int(h[0])%len(s.jobs)]
	m.Lock()
	return m.Unlock
}

func (s *Service) Event(ctx context.Context, user, name string) {
	if s.Activity != nil {
		userName := ""
		if actors, ok := s.Repo.(domain.AuthRepository); ok && user != "" {
			if u, e := actors.UserByID(ctx, user); e == nil {
				userName = u.DisplayName
				if userName == "" {
					userName = u.Username
				}
			}
		}
		if e := s.Activity(ctx, domain.ActivityEntry{Level: "info", UserID: user, UserName: userName, Name: name, Overview: name, Type: "soulseek"}); e != nil {
			slog.Error("Soulseek activity", "error", e)
		}
	}
}
func (s *Service) Destination(ctx context.Context, r domain.SoulseekRule, probe bool) (string, error) {
	folders, err := s.Libraries.MusicLibraries(ctx)
	if err != nil {
		return "", err
	}
	found := false
	p, err := library.ResolveDirectory(s.Roots, r.Folder)
	if err != nil {
		return "", errors.New("Destination folder is unavailable or outside mounted music roots")
	}
	for _, l := range folders {
		if l.ID == r.LibraryID {
			for _, f := range l.Folders {
				canon, e := library.Canonical(f)
				if e == nil && library.Within(canon, p) {
					found = true
				}
			}
		}
	}
	if !found {
		return "", errors.New("Destination no longer belongs to the selected library")
	}
	allowed := false
	for _, root := range s.WritableRoots {
		canon, e := library.Canonical(root)
		if e == nil && library.Within(canon, p) {
			allowed = true
		}
	}
	if !allowed {
		return "", errors.New("Destination is not in SOULSEEK_WRITABLE_ROOTS")
	}
	if s.Stage != "" {
		stage, e := library.Canonical(s.Stage)
		if e == nil && (library.Within(stage, p) || library.Within(p, stage)) {
			return "", errors.New("Staging cannot be an import destination")
		}
	}
	if probe {
		root, e := os.OpenRoot(p)
		if e != nil {
			return "", errors.New("Destination is unavailable")
		}
		defer root.Close()
		name := ".cadence-write-check-" + ID()
		f, e := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			return "", errors.New("Destination is read-only or not writable by Cadence")
		}
		f.Close()
		if e = root.Remove(name); e != nil {
			return "", e
		}
	}
	return p, nil
}
func (s *Service) ValidateSettings(ctx context.Context, v domain.SoulseekSettings) error {
	if err := ValidateDownloadPolicy(v.DownloadPolicy()); err != nil {
		return err
	}
	if v.Enabled && !s.Configured {
		return errors.New("Configure the optional Soulseek container first")
	}
	if v.Presentation != "separate" || !slices.Contains([]string{"before", "after"}, v.ReviewTiming) || !slices.Contains([]string{"disabled", "selected", "imported"}, v.Sharing) {
		return errors.New("Invalid Soulseek settings")
	}
	if len(v.Users)+len(v.Groups)+len(v.UserRules)+len(v.GroupRules) > 10000 {
		return errors.New("Too many access rules")
	}
	rules := append([]domain.SoulseekRule{v.Default}, v.UserRules...)
	rules = append(rules, v.GroupRules...)
	for _, r := range rules {
		if r.Mode != "review" && r.Mode != "auto" {
			return errors.New("Choose review or automatic import")
		}
		if r.Mode == "auto" || r.Folder != "" || r.LibraryID != "" {
			if _, err := s.Destination(ctx, r, true); err != nil {
				return err
			}
		}
	}
	if len(v.ShareFolders) > 100 {
		return errors.New("Choose at most 100 share folders")
	}
	for _, p := range v.ShareFolders {
		resolved, e := library.ResolveDirectory(s.Roots, p)
		if e != nil {
			return errors.New("Share folders must exist within music roots")
		}
		stage, _ := filepath.Abs(s.Stage)
		if s.Stage != "" && (library.Within(resolved, stage) || library.Within(stage, resolved)) {
			return errors.New("Staging cannot be shared")
		}
	}
	for _, list := range [][]domain.SoulseekRule{v.UserRules, v.GroupRules} {
		seen := map[string]bool{}
		for _, r := range list {
			if r.Subject == "" || seen[r.Subject] {
				return errors.New("Each user or group can have only one routing rule")
			}
			seen[r.Subject] = true
		}
	}
	return nil
}
func (s *Service) SaveSettings(ctx context.Context, v domain.SoulseekSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Retain compatibility with clients that still send the old placement setting.
	v.Presentation = "separate"
	if err := s.ValidateSettings(ctx, v); err != nil {
		return err
	}
	old, err := s.Repo.SoulseekSettings(ctx)
	if err != nil {
		return err
	}
	v.ManagedShares = old.ManagedShares
	v.SharingError = ""
	if err = s.Repo.SaveSoulseekSettings(ctx, v); err != nil {
		return err
	}
	return s.syncShares(ctx)
}
func (s *Service) syncShares(ctx context.Context) error {
	v, err := s.Repo.SoulseekSettings(ctx)
	if err != nil {
		return err
	}
	if !s.Configured {
		return nil
	}
	wanted := []string{}
	if v.Enabled && v.Sharing == "selected" {
		wanted = append(wanted, v.ShareFolders...)
	}
	if v.Enabled && v.Sharing == "imported" {
		for offset := 0; ; offset += 500 {
			jobs, e := s.Repo.SoulseekRequests(ctx, "", false, 500, offset)
			if e != nil {
				return e
			}
			for _, r := range jobs {
				if _, e := s.Destination(ctx, r.Rule, false); e != nil {
					continue
				}
				for _, f := range r.Files {
					if f.ImportedPath != "" {
						p := filepath.ToSlash(filepath.Dir(f.ImportedPath))
						if !slices.Contains(wanted, p) {
							wanted = append(wanted, p)
						}
					}
				}
			}
			if len(jobs) < 500 {
				break
			}
		}
	}
	// Dedicated aliases distinguish Cadence's entries from operator-configured shares.
	for i, p := range wanted {
		h := sha256.Sum256([]byte(p))
		wanted[i] = "[Cadence-" + hex.EncodeToString(h[:4]) + "]" + p
	}
	slices.Sort(wanted)
	old := append([]string{}, v.ManagedShares...)
	slices.Sort(old)
	if slices.Equal(old, wanted) && v.SharingError == "" {
		return nil
	}
	if err = s.Remote.SyncShares(ctx, v.ManagedShares, wanted); err != nil {
		v.SharingError = "Unable to synchronize shares; check slskd administrator credentials, remote configuration, and matching mounts"
	} else {
		v.ManagedShares = wanted
		v.SharingError = ""
	}
	return s.Repo.SaveSoulseekSettings(ctx, v)
}
func validRemoteFile(f domain.SoulseekFile) bool {
	name := strings.ReplaceAll(f.Filename, `\`, "/")
	if len(name) > 2000 || strings.ContainsAny(name, "\x00\r\n") || f.Size <= 0 || !Audio(name) {
		return false
	}
	for _, p := range strings.Split(name, "/") {
		if p == ".." || p == "." {
			return false
		}
	}
	base := path.Base(name)
	return base != "" && !strings.ContainsAny(base, `:*?"<>|`) && !strings.HasSuffix(base, ".") && !strings.HasSuffix(base, " ")
}
func (s *Service) Create(ctx context.Context, u domain.User, id, peer, folder string, files []domain.SoulseekFile) (domain.SoulseekRequest, error) {
	return s.CreateSelection(ctx, u, id, peer, folder, files, false)
}

func (s *Service) CreateSelection(ctx context.Context, u domain.User, id, peer, folder string, files []domain.SoulseekFile, album bool) (domain.SoulseekRequest, error) {
	unlock := s.requestLock(id)
	defer unlock()
	if !ValidID(id) || strings.TrimSpace(peer) == "" || len(peer) > 500 {
		return domain.SoulseekRequest{}, errors.New("Choose one to 500 audio files and a valid request ID")
	}
	if old, e := s.Repo.SoulseekRequest(ctx, id); e == nil {
		if old.UserID != u.ID {
			return old, domain.ErrConflict
		}
		return old, nil
	} else if !errors.Is(e, domain.ErrNotFound) {
		return old, e
	}
	cfg, e := s.Repo.SoulseekSettings(ctx)
	if e != nil {
		return domain.SoulseekRequest{}, e
	}
	if !cfg.Allows(u) {
		return domain.SoulseekRequest{}, errors.New("Soulseek access is disabled")
	}
	policy := cfg.DownloadPolicy()
	if album {
		files = FilterFiles(files, policy)
	}
	if len(files) == 0 {
		return domain.SoulseekRequest{}, errors.New("No audio files match the download quality policy")
	}
	if len(files) > 500 {
		return domain.SoulseekRequest{}, errors.New("Choose at most 500 eligible audio files")
	}
	r := domain.SoulseekRequest{DownloadPolicy: policy, ID: id, UserID: u.ID, Username: peer, Folder: folder, Rule: cfg.Rule(u), ReviewTiming: cfg.ReviewTiming, State: "queued", BatchID: ID(), Created: time.Now().UTC(), Files: []domain.SoulseekRequestFile{}}
	seen := map[string]bool{}
	for _, f := range files {
		if !EligibleFile(f, r.DownloadPolicy) {
			return r, errors.New("Selected audio does not match the download quality policy")
		}
		base := strings.ToLower(path.Base(strings.ReplaceAll(f.Filename, `\`, "/")))
		if !validRemoteFile(f) || RemoteFolder(f.Filename) != folder || seen[base] {
			return r, errors.New("Invalid audio selection or duplicate filenames")
		}
		seen[base] = true
		r.Files = append(r.Files, domain.SoulseekRequestFile{SoulseekFile: f, State: "pending"})
	}
	if r.Rule.Mode == "auto" {
		if _, e = s.Destination(ctx, r.Rule, true); e != nil {
			return r, e
		}
		r.Approved = true
	} else if r.ReviewTiming == "before" {
		r.State = "review_before"
	}
	if e = s.Repo.SaveSoulseekRequest(ctx, &r); e == nil {
		s.Event(ctx, u.ID, "Soulseek download requested")
	}
	return r, e
}
func (s *Service) Action(ctx context.Context, u domain.User, id, action string, rule domain.SoulseekRule) (domain.SoulseekRequest, error) {
	unlock := s.requestLock(id)
	defer unlock()
	r, e := s.Repo.SoulseekRequest(ctx, id)
	if e != nil {
		return r, e
	}
	if !u.Admin && r.UserID != u.ID {
		return r, domain.ErrNotFound
	}
	switch action {
	case "approve":
		if !u.Admin {
			return r, errors.New("Administrator approval is required")
		}
		if !slices.Contains([]string{"review_before", "review_after", "blocked"}, r.State) {
			return r, domain.ErrConflict
		}
		if _, e = s.Destination(ctx, rule, true); e != nil {
			return r, e
		}
		r.Rule = rule
		r.Approved = true
		r.Error = ""
		if r.State == "review_before" {
			r.State = "queued"
		} else {
			r.State = "importing"
		}
	case "reject":
		if !u.Admin {
			return r, errors.New("Administrator approval is required")
		}
		if !slices.Contains([]string{"review_before", "review_after", "blocked"}, r.State) {
			return r, domain.ErrConflict
		}
		r.State = "rejected"
		r.Error = ""
	case "cancel":
		if !slices.Contains([]string{"queued", "downloading", "review_before", "review_after", "failed", "blocked"}, r.State) {
			return r, domain.ErrConflict
		}
		r.State = "cancelling"
		r.Error = ""
	case "retry":
		if !slices.Contains([]string{"failed", "cancelled", "blocked"}, r.State) {
			return r, domain.ErrConflict
		}
		if r.State == "blocked" {
			if _, e = s.Destination(ctx, r.Rule, true); e != nil {
				return r, e
			}
			r.State = "importing"
		} else {
			// A partial enqueue may have succeeded before transfer IDs were saved.
			batch, batchErr := s.Remote.Batch(ctx, r.BatchID)
			var ae *APIError
			if batchErr != nil && !(errors.As(batchErr, &ae) && ae.Status == 404) {
				return r, batchErr
			}
			for _, transfer := range batch.Transfers {
				if e = s.Remote.Cancel(ctx, r.Username, transfer.ID); e != nil && !(errors.As(e, &ae) && ae.Status == 404) {
					return r, e
				}
			}
			r.PreviousBatches = append(r.PreviousBatches, r.BatchID)
			r.BatchID = ID()
			r.State = "queued"
			if !r.Approved && r.ReviewTiming == "before" {
				r.State = "review_before"
			}
			for i := range r.Files {
				if r.Files[i].ImportedPath == "" {
					r.Files[i].TransferID = ""
					r.Files[i].State = "pending"
					r.Files[i].BytesTransferred = 0
				}
			}
		}
		r.Error = ""
	case "delete-staging":
		if !u.Admin || !slices.Contains([]string{"rejected", "cancelled", "imported"}, r.State) {
			return r, domain.ErrConflict
		}
		if !ValidID(r.BatchID) {
			return r, domain.ErrConflict
		}
		root, e := os.OpenRoot(s.Stage)
		if e != nil {
			return r, e
		}
		defer root.Close()
		for _, batch := range append(append([]string{}, r.PreviousBatches...), r.BatchID) {
			if !ValidID(batch) {
				return r, domain.ErrConflict
			}
			if e = root.RemoveAll(batch); e != nil {
				return r, e
			}
		}
		r.State = "deleted"
	default:
		return r, errors.New("Unknown Soulseek action")
	}
	if e = s.Repo.SaveSoulseekRequest(ctx, &r); e == nil {
		s.Event(ctx, r.UserID, "Soulseek request "+action)
	}
	return r, e
}
func (s *Service) Run(ctx context.Context) {
	t := time.NewTicker(5 * time.Second)
	defer t.Stop()
	for {
		if e := s.Tick(ctx); e != nil && ctx.Err() == nil {
			slog.Error("Soulseek reconciliation", "error", e)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
func (s *Service) Tick(ctx context.Context) error {
	cfg, e := s.Repo.SoulseekSettings(ctx)
	if e != nil {
		return e
	}
	if !s.Configured {
		return nil
	}
	// Pagination is gathered before mutations so state changes cannot skip jobs.
	jobs := []domain.SoulseekRequest{}
	for offset := 0; ; offset += 500 {
		part, e := s.Repo.SoulseekRequests(ctx, "", true, 500, offset)
		if e != nil {
			return e
		}
		jobs = append(jobs, part...)
		if len(part) < 500 {
			break
		}
	}
	for _, snapshot := range jobs {
		cfg, e = s.Repo.SoulseekSettings(ctx)
		if e != nil {
			return e
		}
		unlock := s.requestLock(snapshot.ID)
		r, loadErr := s.Repo.SoulseekRequest(ctx, snapshot.ID)
		if loadErr != nil {
			unlock()
			if errors.Is(loadErr, domain.ErrNotFound) {
				continue
			}
			return loadErr
		}
		if !cfg.Enabled && r.State != "cancelling" {
			unlock()
			continue
		}
		if !slices.Contains([]string{"queued", "downloading", "importing", "cancelling"}, r.State) {
			unlock()
			continue
		}
		if ctx.Err() != nil {
			unlock()
			return ctx.Err()
		}
		e = s.reconcile(ctx, &r)
		unlock()
		if e != nil {
			if errors.Is(e, ErrUnavailable) {
				continue
			}
			return e
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.syncShares(ctx)
}
func (s *Service) reconcile(ctx context.Context, r *domain.SoulseekRequest) error {
	before := r.State
	if r.State == "queued" {
		_, e := s.Remote.Batch(ctx, r.BatchID)
		var ae *APIError
		if errors.As(e, &ae) && ae.Status == 404 {
			e = s.Remote.Enqueue(ctx, *r)
		}
		if e != nil {
			if errors.Is(e, ErrUnavailable) {
				return e
			}
			r.State = "failed"
			r.Error = "Unable to queue transfer; retry the request"
		} else {
			r.State = "downloading"
		}
	}
	if r.State == "downloading" || r.State == "cancelling" {
		batch, e := s.Remote.Batch(ctx, r.BatchID)
		var ae *APIError
		if e != nil {
			if r.State == "cancelling" && errors.As(e, &ae) && ae.Status == 404 {
				r.State = "cancelled"
				return s.Repo.SaveSoulseekRequest(ctx, r)
			}
			if errors.As(e, &ae) && ae.Status == 404 {
				r.State = "failed"
				r.Error = "Transfer history is unavailable; retry the request"
				return s.Repo.SaveSoulseekRequest(ctx, r)
			}
			return e
		}
		done, failed := true, false
		for i := range r.Files {
			f := &r.Files[i]
			if f.ImportedPath != "" {
				continue
			}
			var transfer *Transfer
			for j := range batch.Transfers {
				if batch.Transfers[j].Filename == f.Filename {
					transfer = &batch.Transfers[j]
					break
				}
			}
			if transfer == nil {
				failed = true
				f.State = "missing"
				continue
			}
			f.TransferID = transfer.ID
			f.State = transfer.State
			f.BytesTransferred = transfer.BytesTransferred
			f.PlaceInQueue = transfer.PlaceInQueue
			if r.State == "cancelling" {
				e = s.Remote.Cancel(ctx, r.Username, transfer.ID)
				if e != nil && !(errors.As(e, &ae) && ae.Status == 404) {
					return e
				}
				continue
			}
			if strings.Contains(transfer.State, "Errored") || strings.Contains(transfer.State, "Cancelled") {
				failed = true
			} else if !strings.Contains(transfer.State, "Succeeded") {
				done = false
			}
		}
		if r.State == "cancelling" {
			r.State = "cancelled"
		} else if failed {
			r.State = "failed"
			r.Error = "One or more files failed; retry the request"
		} else if done {
			if !r.Approved && r.ReviewTiming == "after" {
				r.State = "review_after"
			} else {
				r.State = "importing"
			}
		}
	}
	if r.State == "importing" {
		destination, e := s.Destination(ctx, r.Rule, true)
		if e != nil {
			r.State = "blocked"
			r.Error = e.Error()
		} else {
			for i := range r.Files {
				f := &r.Files[i]
				if f.ImportedPath != "" {
					continue
				}
				p, digest, e := s.importFile(ctx, r.ID, r.BatchID, destination, *f, r.DownloadPolicy)
				if e != nil {
					r.State = "blocked"
					r.Error = e.Error()
					break
				}
				f.ImportedPath = p
				f.Digest = digest
				f.State = "imported"
				if e = s.Repo.SaveSoulseekRequest(ctx, r); e != nil {
					return e
				}
				if s.Scan != nil {
					s.Scan()
				}
			}
			if r.State == "importing" {
				r.State = "imported"
				r.Error = ""
			}
		}
	}
	if e := s.Repo.SaveSoulseekRequest(ctx, r); e != nil {
		return e
	}
	if before != r.State {
		s.Event(ctx, r.UserID, "Soulseek request "+r.State)
	}
	return nil
}
func probeAudioPolicy(ctx context.Context, f *os.File, policy *domain.SoulseekDownloadPolicy) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-protocol_whitelist", "pipe", "-show_entries", "stream=codec_type,codec_name", "-of", "json", "-i", "pipe:0")
	cmd.Stdin = f
	data, e := cmd.Output()
	if e != nil {
		return errors.New("Downloaded file failed audio validation")
	}
	var out struct {
		Streams []struct {
			CodecType string `json:"codec_type"`
			CodecName string `json:"codec_name"`
		}
	}
	if json.Unmarshal(data, &out) != nil {
		return errors.New("Downloaded file failed audio validation")
	}
	found := false
	for _, v := range out.Streams {
		if v.CodecType != "audio" {
			continue
		}
		found = true
		if policy != nil && policy.LosslessOnly && !domain.LosslessCodec(v.CodecName) {
			return errors.New("Downloaded audio is not lossless; choose another source or ask an administrator to change the policy for a new request")
		}
	}
	if found {
		return nil
	}
	return errors.New("Downloaded file contains no audio")
}
func (s *Service) importFile(ctx context.Context, id, batch, dest string, f domain.SoulseekRequestFile, policies ...*domain.SoulseekDownloadPolicy) (string, string, error) {
	if !ValidID(id) || !ValidID(batch) || !validRemoteFile(f.SoulseekFile) {
		return "", "", errors.New("Invalid import path")
	}
	src, e := os.OpenRoot(s.Stage)
	if e != nil {
		return "", "", errors.New("Download staging is unavailable")
	}
	defer src.Close()
	name := path.Base(strings.ReplaceAll(f.Filename, `\`, "/"))
	relative := filepath.Join(batch, name)
	info, e := src.Lstat(relative)
	if e != nil || !info.Mode().IsRegular() || info.Size() != f.Size {
		return "", "", errors.New("Completed download is unavailable or has an unexpected size")
	}
	in, e := src.Open(relative)
	if e != nil {
		return "", "", errors.New("Completed download cannot be read")
	}
	defer in.Close()
	validate := s.ValidateAudio
	if validate == nil {
		var policy *domain.SoulseekDownloadPolicy
		if len(policies) > 0 {
			policy = policies[0]
		}
		validate = func(ctx context.Context, f *os.File) error { return probeAudioPolicy(ctx, f, policy) }
	}
	if e = validate(ctx, in); e != nil {
		return "", "", e
	}
	if _, e = in.Seek(0, 0); e != nil {
		return "", "", e
	}
	root, e := os.OpenRoot(dest)
	if e != nil {
		return "", "", errors.New("Import destination is unavailable")
	}
	defer root.Close()
	// Each request contains one remote folder; preserve the original file names in
	// its own directory. Root methods prevent symlink escapes even during races.
	dir := "Soulseek-" + id
	if e = root.MkdirAll(dir, 0750); e != nil {
		return "", "", errors.New("Import destination is not writable")
	}
	final := filepath.Join(dir, name)
	temp := filepath.Join(dir, ".cadence-"+ID()+".part")
	out, e := root.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0640)
	if e != nil {
		return "", "", errors.New("Cannot create import file")
	}
	defer root.Remove(temp)
	h := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(out, h), &contextReader{ctx: ctx, r: in})
	e = copyErr
	if e == nil && written != f.Size {
		e = errors.New("Downloaded file changed during import")
	}
	if e == nil {
		e = out.Sync()
	}
	closeErr := out.Close()
	if e != nil || closeErr != nil {
		return "", "", errors.New("Import copy failed; check disk space and permissions")
	}
	digest := hex.EncodeToString(h.Sum(nil))
	// Hard-link finalization is atomic and fails if the destination already exists.
	// A matching existing file recovers a crash between publication and DB commit.
	if e = root.Link(temp, final); e != nil {
		info, statErr := root.Lstat(final)
		if statErr != nil || !info.Mode().IsRegular() || info.Size() != f.Size {
			return "", "", fmt.Errorf("Cannot finalize import without overwriting an existing file")
		}
		existing, e := root.Open(final)
		if e != nil {
			return "", "", e
		}
		defer existing.Close()
		hash := sha256.New()
		if _, e = io.Copy(hash, existing); e != nil || hex.EncodeToString(hash.Sum(nil)) != digest {
			return "", "", errors.New("Import filename collision; existing file was preserved")
		}
	}
	return filepath.ToSlash(filepath.Join(dest, final)), digest, nil
}

type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (c *contextReader) Read(b []byte) (int, error) {
	if e := c.ctx.Err(); e != nil {
		return 0, e
	}
	return c.r.Read(b)
}
