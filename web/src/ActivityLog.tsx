// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from "react";
import { Search, RefreshCw } from "lucide-react";
import { api } from "./api";
type Entry = {
  id: number;
  created: string;
  level: string;
  userId: string;
  userName: string;
  name: string;
  overview: string;
  type: string;
};
type Page = { items: Entry[]; total: number };
export function ActivityLog() {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<Page>({ items: [], total: 0 });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const pageSize = 25;
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const params = new URLSearchParams({
          filter,
          q: query,
          limit: String(pageSize),
          offset: String(offset),
        });
        const data = await api<Page>(`/admin/activity?${params}`);
        if (live) {
          setResult(data);
          setError("");
          setLoading(false);
        }
      } catch (error) {
        if (live) {
          setError((error as Error).message);
          setLoading(false);
        }
      }
    };
    setLoading(true);
    const debounce = window.setTimeout(() => void load(), 200);
    const timer = window.setInterval(() => void load(), 15000);
    return () => {
      live = false;
      window.clearTimeout(debounce);
      window.clearInterval(timer);
    };
  }, [filter, query, offset, revision]);
  return (
    <div className="panel activity-panel">
      <div className="row activity-toolbar">
        <div
          className="activity-filters"
          role="group"
          aria-label="Activity category"
        >
          {["all", "user", "system"].map((value) => (
            <button
              key={value}
              aria-pressed={filter === value}
              className={filter === value ? "selected" : ""}
              onClick={() => {
                setFilter(value);
                setOffset(0);
              }}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <label className="device-search">
          <Search size={18} />
          <input
            aria-label="Search activity"
            placeholder="Search activity"
            value={query}
            maxLength={120}
            onChange={(event) => {
              setQuery(event.target.value);
              setOffset(0);
            }}
          />
        </label>
        <button
          aria-label="Refresh activity"
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="device-table-scroll" aria-busy={loading}>
        <table className="device-table activity-table">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Level</th>
              <th scope="col">User</th>
              <th scope="col">Name</th>
              <th scope="col">Overview</th>
              <th scope="col">Type</th>
            </tr>
          </thead>
          <tbody>
            {!loading &&
              result.items.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <time dateTime={entry.created}>
                      {new Date(entry.created).toLocaleString()}
                    </time>
                  </td>
                  <td>
                    <span
                      className={`activity-level activity-level-${entry.level.toLowerCase()}`}
                    >
                      {entry.level}
                    </span>
                  </td>
                  <td>{entry.userName || "System"}</td>
                  <td>{entry.name}</td>
                  <td>{entry.overview || "—"}</td>
                  <td>
                    <small>{entry.type}</small>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {loading ? (
          <p role="status">Loading activity…</p>
        ) : (
          !result.items.length &&
          !error && (
            <p className="muted">
              {query || filter !== "all"
                ? "No activity matches these filters."
                : "No activity yet. New events will appear here."}
            </p>
          )
        )}
      </div>
      <div className="row activity-pagination">
        <span className="muted">
          {result.total
            ? `${Math.min(offset + 1, result.total)}–${Math.min(offset + pageSize, result.total)} of ${result.total.toLocaleString()}`
            : "0 events"}
        </span>
        <button
          disabled={loading || offset === 0}
          onClick={() => setOffset((value) => Math.max(0, value - pageSize))}
        >
          Previous
        </button>
        <button
          disabled={loading || offset + pageSize >= result.total}
          onClick={() => setOffset((value) => value + pageSize)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
