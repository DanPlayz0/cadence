// SPDX-License-Identifier: GPL-2.0-or-later
import { Form } from "../ui/form";
import { Input } from "../ui/input";
import { useEffect, useState } from "react";
import { api, APIError } from "../../services/api";
import { Button } from "../ui/button";

type Settings = {
  configured: boolean;
  source: "none" | "web" | "environment";
  error: string;
  publicUrlConfigured: boolean;
};
export function SyncAdminSettings({ onExpired }: { onExpired: () => void }) {
  const [settings, setSettings] = useState<Settings>();
  const [apiKey, setAPIKey] = useState("");
  const [apiSecret, setAPISecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  function failure(e: unknown) {
    if (e instanceof APIError && e.status === 401) onExpired();
    else
      setError(
        e instanceof Error ? e.message : "Unable to update Last.fm settings",
      );
  }
  useEffect(() => {
    let active = true;
    void api<Settings>("/admin/sync/lastfm")
      .then((v) => {
        if (active) setSettings(v);
      })
      .catch((e) => {
        if (active) failure(e);
      });
    return () => {
      active = false;
    };
  }, []);
  async function save(remove = false) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<Settings>(
        "/admin/sync/lastfm",
        remove ? "DELETE" : "PUT",
        remove
          ? undefined
          : { apiKey: apiKey.trim(), apiSecret: apiSecret.trim() },
      );
      setSettings(result);
      setAPIKey("");
      setAPISecret("");
      setNotice(
        remove
          ? "Last.fm disabled. Pending listens are retained."
          : "Last.fm credentials saved. Changes apply immediately; listeners can connect from Listening settings → Sync.",
      );
    } catch (e) {
      failure(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel admin-panel">
      <h2>Last.fm application credentials</h2>
      <p>
        Configure Last.fm once for this instance. Each listener then connects
        their own Last.fm account in Listening settings → Sync.
      </p>
      <p>
        <a
          href="https://www.last.fm/api/account/create"
          target="_blank"
          rel="noreferrer"
        >
          Get a Last.fm API key and secret
        </a>
      </p>
      {settings && (
        <p role="status">
          {settings.configured ? "Configured" : "Not configured"}
          {settings.source === "environment"
            ? " · Using environment credentials"
            : settings.source === "web"
              ? " · Saved through the web UI"
              : ""}
        </p>
      )}
      {settings?.error && <p role="alert">{settings.error}</p>}
      {settings && !settings.publicUrlConfigured && (
        <p role="alert">
          Set PUBLIC_URL to this instance’s browser-accessible address so
          Last.fm can return listeners here after authorization.
        </p>
      )}
      <Form
        className="admin-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset className="sync-admin-fields" disabled={busy || !settings}>
          <label>
            API key
            <Input
              aria-label="Last.fm API key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setAPIKey(e.target.value)}
              maxLength={256}
              required
            />
          </label>
          <label>
            API secret
            <Input
              aria-label="Last.fm API secret"
              type="password"
              autoComplete="off"
              value={apiSecret}
              onChange={(e) => setAPISecret(e.target.value)}
              maxLength={256}
              required
            />
          </label>
          <p className="muted">
            Saved values are encrypted and never shown here. Enter both fields
            to replace them. Replacing credentials requires connected listeners
            to reconnect Last.fm.
          </p>
          <Button type="submit" disabled={!apiKey.trim() || !apiSecret.trim()}>
            Save Last.fm credentials
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={!settings?.configured && !settings?.error}
            onClick={() => void save(true)}
          >
            Disable Last.fm
          </Button>
        </fieldset>
      </Form>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      <p className="muted">
        Web settings override environment credentials. Disabling Last.fm keeps
        it disabled after restart, including when environment credentials are
        present. ListenBrainz only needs each listener’s personal token.
      </p>
    </section>
  );
}
