// SPDX-License-Identifier: GPL-2.0-or-later
package soulseek

import (
	"bytes"
	"cadence/internal/domain"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"gopkg.in/yaml.v3"
	"io"
	"net/http"
	"net/url"
	"path"
	"slices"
	"strings"
	"time"
)

var ErrUnavailable = errors.New("Soulseek is unavailable; check the container and connection settings")

type APIError struct{ Status int }

func (e *APIError) Error() string { return fmt.Sprintf("Soulseek returned HTTP %d", e.Status) }

type Transfer struct {
	ID               string `json:"id"`
	Filename         string `json:"filename"`
	State            string `json:"state"`
	BytesTransferred int64  `json:"bytesTransferred"`
	PlaceInQueue     *int   `json:"placeInQueue"`
}
type Batch struct {
	Transfers []Transfer `json:"transfers"`
}
type Remote interface {
	StartSearch(context.Context, string, string) error
	Search(context.Context, string) (domain.SoulseekSearch, error)
	Folder(context.Context, string, string) ([]domain.SoulseekFile, error)
	Enqueue(context.Context, domain.SoulseekRequest) error
	Batch(context.Context, string) (Batch, error)
	Cancel(context.Context, string, string) error
	SyncShares(context.Context, []string, []string) error
}
type Client struct {
	URL, Key, Username, Password string
	HTTP                         *http.Client
}

func NewClient(base, key, username, password string) *Client {
	return &Client{URL: strings.TrimRight(base, "/"), Key: key, Username: username, Password: password, HTTP: &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}
func (c *Client) Configured() bool {
	u, e := url.Parse(c.URL)
	return e == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" && c.Key != ""
}
func (c *Client) call(ctx context.Context, method, p string, body, out any, token string) error {
	if !c.Configured() {
		return ErrUnavailable
	}
	var payload []byte
	var err error
	if body != nil {
		payload, err = json.Marshal(body)
		if err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, c.URL+"/api/v0"+p, bytes.NewReader(payload))
	if err != nil {
		return ErrUnavailable
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	} else {
		req.Header.Set("X-API-Key", c.Key)
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return ErrUnavailable
	}
	defer res.Body.Close()
	if res.StatusCode >= 500 {
		return ErrUnavailable
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return &APIError{res.StatusCode}
	}
	if out == nil {
		return nil
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, 32<<20+1))
	if err != nil || len(b) > 32<<20 {
		return ErrUnavailable
	}
	if json.Unmarshal(b, out) != nil {
		return errors.New("Soulseek returned an invalid response")
	}
	return nil
}
func (c *Client) StartSearch(ctx context.Context, id, q string) error {
	return c.call(ctx, "POST", "/searches", map[string]any{"id": id, "searchText": q, "fileLimit": 5000, "responseLimit": 100, "searchTimeout": 15}, nil, "")
}
func Audio(name string) bool {
	switch strings.ToLower(path.Ext(name)) {
	case ".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wav":
		return true
	}
	return false
}
func RemoteFolder(name string) string { return path.Dir(strings.ReplaceAll(name, `\`, "/")) }
func (c *Client) Search(ctx context.Context, id string) (domain.SoulseekSearch, error) {
	var raw struct {
		ID, State string
		Responses []struct {
			Username          string
			QueueLength       int
			HasFreeUploadSlot bool
			UploadSpeed       int64
			Files             []domain.SoulseekFile
		}
	}
	err := c.call(ctx, "GET", "/searches/"+url.PathEscape(id)+"?includeResponses=true", nil, &raw, "")
	out := domain.SoulseekSearch{ID: id, State: raw.State, Results: []domain.SoulseekResult{}}
	for _, r := range raw.Responses {
		for _, f := range r.Files {
			if Audio(f.Filename) {
				out.Results = append(out.Results, domain.SoulseekResult{Username: r.Username, Folder: RemoteFolder(f.Filename), QueueLength: r.QueueLength, HasFreeUploadSlot: r.HasFreeUploadSlot, UploadSpeed: r.UploadSpeed, SoulseekFile: f})
			}
		}
	}
	return out, err
}
func (c *Client) Folder(ctx context.Context, user, folder string) ([]domain.SoulseekFile, error) {
	var dirs []struct {
		Name  string
		Files []domain.SoulseekFile
	}
	err := c.call(ctx, "POST", "/users/"+url.PathEscape(user)+"/directory", map[string]string{"directory": strings.ReplaceAll(folder, "/", `\`)}, &dirs, "")
	out := []domain.SoulseekFile{}
	for _, d := range dirs {
		if strings.ReplaceAll(d.Name, `\`, "/") != folder {
			continue
		}
		for _, f := range d.Files {
			if !strings.ContainsAny(f.Filename, `\/`) {
				f.Filename = strings.ReplaceAll(folder, "/", `\`) + `\` + f.Filename
			}
			if Audio(f.Filename) {
				out = append(out, f)
			}
		}
	}
	return out, err
}
func (c *Client) Enqueue(ctx context.Context, r domain.SoulseekRequest) error {
	files := []domain.SoulseekFile{}
	for _, f := range r.Files {
		if f.ImportedPath == "" {
			files = append(files, domain.SoulseekFile{Filename: f.Filename, Size: f.Size})
		}
	}
	var out struct{ Failures []struct{ Filename string } }
	err := c.call(ctx, "POST", "/transfers/downloads/batches", map[string]any{"id": r.BatchID, "username": r.Username, "files": files, "options": map[string]string{"destination": r.BatchID, "externalId": r.ID}}, &out, "")
	if err == nil && len(out.Failures) > 0 {
		return errors.New("Some files could not be queued; inspect and retry the request")
	}
	return err
}
func (c *Client) Batch(ctx context.Context, id string) (Batch, error) {
	var b Batch
	e := c.call(ctx, "GET", "/transfers/downloads/batches/"+url.PathEscape(id), nil, &b, "")
	return b, e
}
func (c *Client) Cancel(ctx context.Context, user, id string) error {
	return c.call(ctx, "DELETE", "/transfers/downloads/"+url.PathEscape(user)+"/"+url.PathEscape(id)+"?remove=true", nil, nil, "")
}

// The YAML API is JWT-only. Preserve the complete configuration server-side and
// alter only the shares Cadence previously installed. Never expose YAML to clients.
func (c *Client) SyncShares(ctx context.Context, old, wanted []string) error {
	var session struct{ Token string }
	if err := c.call(ctx, "POST", "/session", map[string]string{"username": c.Username, "password": c.Password}, &session, ""); err != nil {
		return err
	}
	if session.Token == "" {
		return errors.New("Soulseek administrator login failed")
	}
	var source string
	if err := c.call(ctx, "GET", "/options/yaml", nil, &source, session.Token); err != nil {
		return err
	}
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(source), &doc); err != nil {
		return errors.New("Unable to read Soulseek sharing configuration")
	}
	if len(doc.Content) == 0 {
		doc.Kind = yaml.DocumentNode
		doc.Content = []*yaml.Node{{Kind: yaml.MappingNode, Tag: "!!map"}}
	}
	root := doc.Content[0]
	if root.Kind != yaml.MappingNode {
		return errors.New("Invalid Soulseek sharing configuration")
	}
	shares := yamlField(root, "shares", yaml.MappingNode)
	if shares.Kind != yaml.MappingNode {
		return errors.New("Invalid Soulseek shares configuration")
	}
	dirs := yamlField(shares, "directories", yaml.SequenceNode)
	if dirs.Kind != yaml.SequenceNode {
		return errors.New("Invalid Soulseek shares list")
	}
	keep := []*yaml.Node{}
	for _, n := range dirs.Content {
		if !slices.Contains(old, n.Value) {
			keep = append(keep, n)
		}
	}
	dirs.Content = keep
	for _, p := range wanted {
		found := false
		for _, n := range dirs.Content {
			if n.Value == p {
				found = true
			}
		}
		if !found {
			dirs.Content = append(dirs.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: p})
		}
	}
	// A shared import folder can receive later retries. Hide unpublished copies
	// while retaining every operator-defined share filter.
	filters := yamlField(shares, "filters", yaml.SequenceNode)
	if filters.Kind != yaml.SequenceNode {
		return errors.New("Invalid Soulseek share filters")
	}
	const temporaryFilter = `\.cadence-[^\\/]+\.part$`
	found := false
	for _, n := range filters.Content {
		if n.Value == temporaryFilter {
			found = true
		}
	}
	if !found {
		filters.Content = append(filters.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: temporaryFilter})
	}
	encoded, err := yaml.Marshal(&doc)
	if err != nil {
		return errors.New("Unable to update Soulseek shares")
	}
	return c.call(ctx, "PUT", "/options/yaml", string(encoded), nil, session.Token)
}
func yamlField(n *yaml.Node, key string, kind yaml.Kind) *yaml.Node {
	for i := 0; i+1 < len(n.Content); i += 2 {
		if n.Content[i].Value == key {
			v := n.Content[i+1]
			if v.Tag == "!!null" {
				v.Kind = kind
				v.Tag = ""
				v.Value = ""
			}
			return v
		}
	}
	v := &yaml.Node{Kind: kind}
	n.Content = append(n.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key}, v)
	return v
}
