// SPDX-License-Identifier: GPL-2.0-or-later
package domain

import (
	"context"
	"time"
)

type SyncPreferences struct {
	Plays      bool `json:"plays"`
	NowPlaying bool `json:"nowPlaying"`
	Likes      bool `json:"likes"`
}

type SyncConnection struct {
	Provider   string `json:"provider"`
	ID         string `json:"-"`
	Username   string `json:"username"`
	Credential []byte `json:"-"`
	SyncPreferences
	Paused          bool       `json:"paused"`
	Error           string     `json:"error"`
	LastSuccess     *time.Time `json:"lastSuccess"`
	Pending         int        `json:"pending"`
	WaitingFeedback int        `json:"waitingFeedback"`
}

type SyncEvent struct {
	EventID   string  `json:"eventId"`
	TrackID   string  `json:"trackId"`
	StartedAt int64   `json:"startedAt"`
	Heard     float64 `json:"heard"`
	Duration  float64 `json:"duration"`
}

type SyncPayload struct {
	TrackID   string  `json:"trackId"`
	Title     string  `json:"title"`
	Artist    string  `json:"artist"`
	Album     string  `json:"album,omitempty"`
	Duration  float64 `json:"duration"`
	StartedAt int64   `json:"startedAt"`
	Liked     bool    `json:"liked"`
}

type SyncDelivery struct {
	ID          string
	UserID      string
	Connection  SyncConnection
	Kind        string
	Payload     SyncPayload
	Attempts    int
	Revision    int
	RecordingID string
}

type SyncExport struct {
	ID             string        `json:"id"`
	Eligible       int           `json:"eligible"`
	PreviouslySent int           `json:"previouslySent"`
	Excluded       int           `json:"excluded"`
	Pending        int           `json:"pending"`
	Sent           int           `json:"sent"`
	Rejected       int           `json:"rejected"`
	Cancelled      int           `json:"cancelled"`
	Failures       []SyncFailure `json:"failures"`
}

type SyncFailure struct {
	Title  string `json:"title"`
	Artist string `json:"artist"`
	Error  string `json:"error"`
}

// SyncRepository is separate from the catalog contract so integrations remain optional.
type SyncRepository interface {
	LastFMSettings(context.Context) ([]byte, bool, error)
	SaveLastFMSettings(context.Context, []byte, bool) error
	SyncConnections(context.Context, string) ([]SyncConnection, error)
	SaveSyncConnection(context.Context, string, SyncConnection) error
	SetSyncPreferences(context.Context, string, string, SyncPreferences) error
	DeleteSyncConnection(context.Context, string, string) error
	SaveSyncAuth(context.Context, string, string, time.Time) error
	ConsumeSyncAuth(context.Context, string, string) (bool, error)
	RecordSyncListen(context.Context, string, SyncEvent, SyncPayload) error
	NextSyncDelivery(context.Context) (*SyncDelivery, error)
	FinishSyncDelivery(context.Context, SyncDelivery, string, string, time.Time) error
	SaveSyncRecording(context.Context, string, string, SyncPayload, string) error
	SyncNotificationResult(context.Context, string, string, string, string) error
	PreviewSyncExport(context.Context, string, string, time.Time, time.Time) (SyncExport, error)
	StartSyncExport(context.Context, string, string, time.Time, time.Time) (SyncExport, error)
	SyncExportStatus(context.Context, string, string) (SyncExport, error)
}
