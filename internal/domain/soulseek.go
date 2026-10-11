// SPDX-License-Identifier: GPL-2.0-or-later
package domain

import (
	"context"
	"slices"
	"time"
)

type SoulseekRule struct {
	Subject   string `json:"subject"`
	Mode      string `json:"mode"`
	LibraryID string `json:"libraryId"`
	Folder    string `json:"folder"`
}
type SoulseekDownloadPolicy struct {
	LosslessOnly   bool     `json:"losslessOnly"`
	AllowedFormats []string `json:"allowedFormats"`
}

func SoulseekAudioFormats() []string {
	return []string{"flac", "wav", "m4a", "mp3", "aac", "ogg", "opus"}
}

func (s SoulseekSettings) DownloadPolicy() *SoulseekDownloadPolicy {
	return &SoulseekDownloadPolicy{LosslessOnly: s.LosslessOnly, AllowedFormats: slices.Clone(s.AllowedFormats)}
}

type SoulseekSettings struct {
	LosslessOnly   bool           `json:"losslessOnly"`
	AllowedFormats []string       `json:"allowedFormats"`
	Enabled        bool           `json:"enabled"`
	Users          []string       `json:"users"`
	Groups         []string       `json:"groups"`
	Presentation   string         `json:"presentation"`
	ReviewTiming   string         `json:"reviewTiming"`
	Default        SoulseekRule   `json:"default"`
	UserRules      []SoulseekRule `json:"userRules"`
	GroupRules     []SoulseekRule `json:"groupRules"`
	Sharing        string         `json:"sharing"`
	ShareFolders   []string       `json:"shareFolders"`
	ManagedShares  []string       `json:"-"`
	SharingError   string         `json:"sharingError"`
}

func DefaultSoulseekSettings() SoulseekSettings {
	return SoulseekSettings{LosslessOnly: true, AllowedFormats: SoulseekAudioFormats(), Users: []string{}, Groups: []string{}, Presentation: "separate", ReviewTiming: "before", Default: SoulseekRule{Mode: "review"}, UserRules: []SoulseekRule{}, GroupRules: []SoulseekRule{}, Sharing: "disabled", ShareFolders: []string{}}
}
func (s SoulseekSettings) Allows(u User) bool {
	if !s.Enabled {
		return false
	}
	if u.Admin || slices.Contains(s.Users, u.ID) {
		return true
	}
	for _, g := range u.Groups {
		if slices.Contains(s.Groups, g) {
			return true
		}
	}
	return false
}
func (s SoulseekSettings) Rule(u User) SoulseekRule {
	for _, r := range s.UserRules {
		if r.Subject == u.ID {
			return r
		}
	}
	for _, r := range s.GroupRules {
		if slices.Contains(u.Groups, r.Subject) {
			return r
		}
	}
	return s.Default
}

type SoulseekFile struct {
	Filename   string `json:"filename"`
	Size       int64  `json:"size"`
	BitRate    int    `json:"bitRate,omitempty"`
	SampleRate int    `json:"sampleRate,omitempty"`
	BitDepth   int    `json:"bitDepth,omitempty"`
	Length     int    `json:"length,omitempty"`
}
type SoulseekResult struct {
	Username          string `json:"username"`
	Folder            string `json:"folder"`
	QueueLength       int    `json:"queueLength"`
	HasFreeUploadSlot bool   `json:"hasFreeUploadSlot"`
	UploadSpeed       int64  `json:"uploadSpeed"`
	SoulseekFile
}
type SoulseekSearch struct {
	ID      string           `json:"id"`
	State   string           `json:"state"`
	Results []SoulseekResult `json:"results"`
}
type SoulseekRequestFile struct {
	SoulseekFile
	TransferID       string `json:"transferId,omitempty"`
	State            string `json:"state"`
	BytesTransferred int64  `json:"bytesTransferred"`
	PlaceInQueue     *int   `json:"placeInQueue,omitempty"`
	ImportedPath     string `json:"-"`
	Digest           string `json:"-"`
}
type SoulseekRequest struct {
	DownloadPolicy  *SoulseekDownloadPolicy `json:"downloadPolicy,omitempty"`
	ID              string                  `json:"id"`
	UserID          string                  `json:"userId"`
	Username        string                  `json:"username"`
	Folder          string                  `json:"folder"`
	Files           []SoulseekRequestFile   `json:"files"`
	Rule            SoulseekRule            `json:"rule"`
	ReviewTiming    string                  `json:"reviewTiming"`
	Approved        bool                    `json:"approved"`
	State           string                  `json:"state"`
	Error           string                  `json:"error"`
	BatchID         string                  `json:"batchId"`
	PreviousBatches []string                `json:"-"`
	Created         time.Time               `json:"created"`
	Revision        int64                   `json:"revision"`
}

// Storage JSON must include private importer fields without exposing them over HTTP.
type SoulseekStoredRequest struct {
	SoulseekRequest
	ImportedPaths   []string `json:"importedPaths"`
	Digests         []string `json:"digests"`
	PreviousBatches []string `json:"previousBatches"`
}
type SoulseekRepository interface {
	SoulseekSettings(context.Context) (SoulseekSettings, error)
	SaveSoulseekSettings(context.Context, SoulseekSettings) error
	CreateSoulseekSearch(context.Context, string, string) error
	OwnsSoulseekSearch(context.Context, string, string) (bool, error)
	SoulseekRequest(context.Context, string) (SoulseekRequest, error)
	SoulseekRequests(context.Context, string, bool, int, int) ([]SoulseekRequest, error)
	SaveSoulseekRequest(context.Context, *SoulseekRequest) error
}
