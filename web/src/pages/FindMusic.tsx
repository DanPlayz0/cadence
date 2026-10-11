// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useMemo, useRef, useState } from "react";
import { Disc3, Search, Download } from "lucide-react";
import { Button } from "../components/ui/button";
import { Form } from "../components/ui/form";
import { Input } from "../components/ui/input";
import { Checkbox } from "../components/ui/Checkbox";
import { Select, SelectItem } from "../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { api } from "../services/api";
import {
  fileName,
  fileSize,
  requestID,
  stateLabel,
  type SoulseekCapabilities,
  type SoulseekSearch,
  type SoulseekResult,
  type SoulseekFile,
  type SoulseekRequest,
} from "../lib/soulseek";
import {
  defaultFind,
  sources,
  naturalFiles,
  quality,
  sourceQuality,
  duration,
  type FindNavigation,
} from "../lib/findMusic";
import { SoulseekRequests } from "../components/soulseek/SoulseekRequests";
import { CatalogBrowser } from "../components/soulseek/CatalogBrowser";
import "../styles/Soulseek.css";
import "../styles/FindMusic.css";

type Folder = {
  result: SoulseekResult;
  files: SoulseekFile[];
  excludedAudioCount: number;
};
export function FindMusic({
  query = "",
  navigation,
  capabilities,
  admin = false,
  onNavigate,
  onLibrary,
  active = true,
}: {
  query?: string;
  navigation?: FindNavigation;
  capabilities: SoulseekCapabilities;
  admin?: boolean;
  onNavigate?: (nav: FindNavigation, replace: boolean) => void;
  onLibrary?: () => void;
  active?: boolean;
}) {
  const [localNav, setNav] = useState<FindNavigation>(
    () => navigation || { ...defaultFind, catalogQuery: query },
  );
  const nav = navigation || localNav;
  const [search, setSearch] = useState<SoulseekSearch | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [pollRetry, setPollRetry] = useState(0);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [folder, setFolder] = useState<Folder | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);
  const [phone, setPhone] = useState(
    () => window.matchMedia("(max-width: 700px)").matches,
  );
  const searchSeq = useRef(0),
    folderSeq = useRef(0),
    downloadSeq = useRef(0);
  const searchLock = useRef(false),
    downloadLock = useRef(false);
  const pending = useRef(new Map<string, string>());
  const requested = useRef(new Set<string>());
  const folderTrigger = useRef<HTMLElement | null>(null);
  const folderHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (navigation) setNav(navigation);
  }, [navigation]);
  useEffect(() => {
    if (active && !navigation) setNav({ ...defaultFind, catalogQuery: query });
  }, [query, active, navigation]);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 700px)");
    const update = () => setPhone(m.matches);
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);
  function change(patch: Partial<FindNavigation>, replace = true) {
    const next = { ...nav, ...patch };
    setNav(next);
    onNavigate?.(next, replace);
  }
  useEffect(() => {
    searchSeq.current++;
    folderSeq.current++;
    downloadSeq.current++;
    setSearch(null);
    setFolder(null);
    setSelected([]);
    setSearchBusy(false);
    setFolderBusy(false);
    setDownloadBusy(false);
    searchLock.current = false;
    downloadLock.current = false;
    setSearchError("");
    setFolderError("");
    setDownloadError("");
    setNotice("");
    pending.current.clear();
    requested.current.clear();
  }, [
    capabilities.allowed,
    capabilities.losslessOnly,
    capabilities.allowedFormats.join(","),
  ]);
  useEffect(
    () => () => {
      searchSeq.current++;
      folderSeq.current++;
      downloadSeq.current++;
    },
    [],
  );
  useEffect(() => {
    if (folder && !phone && active && nav.tab === "direct")
      folderHeading.current?.focus();
  }, [folder, phone]);
  useEffect(() => {
    if (
      !search?.id ||
      !capabilities.allowed ||
      !active ||
      /Completed|Cancelled|Errored|TimedOut/.test(search.state)
    )
      return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const id = search.id,
      seq = searchSeq.current;
    async function poll() {
      try {
        const v = await api<SoulseekSearch>(`/soulseek/searches/${id}`);
        if (!live || seq !== searchSeq.current) return;
        setSearch(v);
        setSearchError("");
        if (!/Completed|Cancelled|Errored|TimedOut/.test(v.state))
          timer = setTimeout(() => void poll(), 1500);
      } catch (e) {
        if (live && seq === searchSeq.current)
          setSearchError((e as Error).message);
      }
    }
    timer = setTimeout(() => void poll(), 1500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search?.id, capabilities.allowed, active, pollRetry]);
  async function start(e: React.FormEvent) {
    e.preventDefault();
    if (
      searchLock.current ||
      !capabilities.allowed ||
      nav.sourceQuery.trim().length < 3
    )
      return;
    searchLock.current = true;
    const seq = ++searchSeq.current;
    folderSeq.current++;
    setSearchBusy(true);
    setSearchError("");
    setFolderError("");
    setFolderBusy(false);
    setSearch(null);
    setFolder(null);
    setSelected([]);
    setOffset(0);
    try {
      const v = await api<SoulseekSearch>("/soulseek/searches", "POST", {
        query: nav.sourceQuery.trim(),
      });
      if (seq === searchSeq.current) setSearch(v);
    } catch (e) {
      if (seq === searchSeq.current) setSearchError((e as Error).message);
    } finally {
      if (seq === searchSeq.current) {
        searchLock.current = false;
        setSearchBusy(false);
      }
    }
  }
  async function openFolder(result: SoulseekResult) {
    if (!search || !capabilities.allowed) return;
    folderTrigger.current = document.activeElement as HTMLElement;
    const seq = ++folderSeq.current;
    setFolder(null);
    setFolderBusy(true);
    setFolderError("");
    setSelected([]);
    try {
      const data = await api<Omit<Folder, "result">>(
        "/soulseek/folder-details",
        "POST",
        {
          searchId: search.id,
          username: result.username,
          folder: result.folder,
        },
      );
      if (seq === folderSeq.current) {
        const files = naturalFiles(data.files);
        setFolder({
          result,
          files,
          excludedAudioCount: data.excludedAudioCount,
        });
        setSelected(files.map((f) => f.filename));
      }
    } catch (e) {
      if (seq === folderSeq.current) setFolderError((e as Error).message);
    } finally {
      if (seq === folderSeq.current) setFolderBusy(false);
    }
  }
  function closeFolder() {
    folderSeq.current++;
    setFolder(null);
    setFolderBusy(false);
    folderTrigger.current?.focus();
  }
  async function download(
    result: SoulseekResult,
    filenames: string[],
    album = false,
  ) {
    if (downloadLock.current || !search || !capabilities.allowed) return;
    const selection = {
      searchId: search.id,
      username: result.username,
      folder: result.folder,
      filenames: [...filenames].sort(),
      album,
    };
    const key = JSON.stringify(selection);
    if (requested.current.has(key)) {
      setNotice(
        "This selection has already been requested. Follow its status in Downloads.",
      );
      return;
    }
    downloadLock.current = true;
    const seq = ++downloadSeq.current;
    setDownloadBusy(true);
    setDownloadError("");
    try {
      if (!pending.current.has(key)) pending.current.set(key, requestID());
      const request = await api<SoulseekRequest>("/soulseek/requests", "POST", {
        id: pending.current.get(key),
        ...selection,
      });
      if (seq !== downloadSeq.current) return;
      pending.current.delete(key);
      requested.current.add(key);
      setNotice(stateLabel(request.state));
      setRevision((v) => v + 1);
    } catch (e) {
      if (seq === downloadSeq.current) setDownloadError((e as Error).message);
    } finally {
      if (seq === downloadSeq.current) {
        downloadLock.current = false;
        setDownloadBusy(false);
      }
    }
  }
  const rows = useMemo(
    () => sources(search?.results || [], nav),
    [search, nav],
  );
  useEffect(
    () => setOffset(0),
    [
      nav.filter,
      nav.format,
      nav.minBitrate,
      nav.freeSlots,
      nav.sort,
      nav.sourceView,
    ],
  );
  useEffect(() => {
    if (offset >= rows.length && offset > 0)
      setOffset(Math.max(0, Math.floor((rows.length - 1) / 50) * 50));
  }, [rows.length, offset]);
  const folderContent = folder && (
    <>
      <div className="soulseek-row">
        {phone ? (
          <DialogTitle>{fileName(folder.result.folder)}</DialogTitle>
        ) : (
          <h2 ref={folderHeading} tabIndex={-1}>
            {fileName(folder.result.folder)}
          </h2>
        )}
        <Button variant="ghost" onClick={closeFolder}>
          Close folder
        </Button>
      </div>
      {phone ? (
        <DialogDescription>
          {folder.result.username} · {folder.files.length} eligible audio files
        </DialogDescription>
      ) : (
        <p>
          {folder.result.username} · {folder.files.length} eligible audio files
        </p>
      )}
      <p className="soulseek-help">
        {folder.excludedAudioCount} audio{" "}
        {folder.excludedAudioCount === 1 ? "file" : "files"} excluded by the
        download policy. This folder may not contain a complete album.
      </p>
      <div className="soulseek-actions">
        <Button
          variant="ghost"
          onClick={() => setSelected(folder.files.map((f) => f.filename))}
        >
          Select all
        </Button>
        <Button variant="ghost" onClick={() => setSelected([])}>
          Clear selection
        </Button>
        <span>{selected.length} selected</span>
      </div>
      <div className="find-folder-files">
        {folder.files.map((f) => (
          <label key={f.filename}>
            <Checkbox
              checked={selected.includes(f.filename)}
              onChange={(e) =>
                setSelected((v) =>
                  e.target.checked
                    ? [...v, f.filename]
                    : v.filter((n) => n !== f.filename),
                )
              }
            />
            <span>
              <strong>{fileName(f.filename)}</strong>
              <small>
                {quality(f)} · {duration(f.length)} · {fileSize(f.size)}
              </small>
            </span>
          </label>
        ))}
      </div>
      {!folder.files.length && (
        <p>No audio files in this folder match the download policy.</p>
      )}
      {downloadError && <p role="alert">{downloadError}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="soulseek-actions">
        <Button
          disabled={downloadBusy || !selected.length || !capabilities.allowed}
          onClick={() => void download(folder.result, selected)}
        >
          Request selected tracks
        </Button>
        <Button
          variant="outline"
          disabled={
            downloadBusy || !folder.files.length || !capabilities.allowed
          }
          onClick={() => void download(folder.result, [], true)}
        >
          Request eligible folder tracks
        </Button>
        {notice && (
          <Button
            variant="ghost"
            onClick={() => {
              closeFolder();
              change({ tab: "downloads" }, false);
            }}
          >
            View downloads
          </Button>
        )}
      </div>
    </>
  );
  return (
    <section className="content soulseek find-music">
      <div className="soulseek-row">
        <div>
          <p className="eyebrow">BEYOND YOUR LIBRARY</p>
          <h1 tabIndex={-1}>Find music</h1>
          <p>
            Discover the music. Choose your source. Make it part of your
            collection.
          </p>
        </div>
        {onLibrary && (
          <Button variant="ghost" onClick={onLibrary}>
            Your library
          </Button>
        )}
      </div>
      <div className="find-tabs" role="group" aria-label="Find music views">
        {(
          [
            ["catalog", "Catalog", Disc3],
            ["direct", "Direct search", Search],
            ["downloads", "Downloads", Download],
          ] as const
        ).map(([tab, label, Icon]) => (
          <Button
            variant="ghost"
            key={tab}
            aria-pressed={nav.tab === tab}
            onClick={() =>
              change(
                {
                  tab,
                  ...(tab === "direct" && !nav.sourceQuery
                    ? {
                        sourceQuery: nav.catalogQuery,
                        sourceView: "files" as const,
                      }
                    : {}),
                },
                false,
              )
            }
          >
            <Icon size={18} />
            {label}
          </Button>
        ))}
      </div>
      <div hidden={nav.tab !== "catalog"}>
        <CatalogBrowser
          nav={nav}
          change={change}
          findDownloads={(item) =>
            change(
              {
                tab: "direct",
                sourceQuery: `${item.artist} ${item.name}`.trim().slice(0, 200),
                sourceView: item.kind === "album" ? "folders" : "files",
              },
              false,
            )
          }
        />
      </div>
      <div hidden={nav.tab !== "direct"}>
        {!capabilities.allowed ? (
          <div className="find-empty">
            <Search size={40} />
            <h2>Downloads aren’t available</h2>
            <p>
              {capabilities.configured
                ? "Soulseek is disabled or your account has not been granted download access."
                : "Soulseek has not been configured on this instance."}{" "}
              You can still explore the catalog.
            </p>
            <Button
              variant="outline"
              onClick={() => change({ tab: "catalog" }, false)}
            >
              Explore catalog
            </Button>
          </div>
        ) : (
          <>
            {nav.selection && (
              <p className="find-context">
                Finding sources for{" "}
                <strong>
                  {nav.selection.artist} · {nav.selection.name}
                </strong>
              </p>
            )}
            <Form className="find-search" onSubmit={(e) => void start(e)}>
              <label className="sr-only" htmlFor="find-source-query">
                Search Soulseek
              </label>
              <Search size={20} aria-hidden="true" />
              <Input
                id="find-source-query"
                value={nav.sourceQuery}
                onChange={(e) => change({ sourceQuery: e.target.value })}
                placeholder="Artist, album, song, or filename"
                maxLength={200}
              />
              <Button
                disabled={searchBusy || nav.sourceQuery.trim().length < 3}
              >
                {searchBusy ? "Starting…" : "Search Soulseek"}
              </Button>
            </Form>
            <p className="soulseek-help">
              {capabilities.losslessOnly
                ? "Lossless audio only"
                : "Any audio quality"}{" "}
              · {capabilities.allowedFormats.join(", ").toUpperCase()} · Folder
              requests include only eligible audio.
            </p>
            {searchError && (
              <div role="alert" className="find-error">
                <p>{searchError}</p>
                {search && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearchError("");
                      setPollRetry((v) => v + 1);
                    }}
                  >
                    Retry search progress
                  </Button>
                )}
              </div>
            )}
            {downloadError && !folder && <p role="alert">{downloadError}</p>}
            {notice && (
              <div className="soulseek-row">
                <p role="status">{notice}</p>
                <Button
                  variant="outline"
                  onClick={() => change({ tab: "downloads" }, false)}
                >
                  View downloads
                </Button>
              </div>
            )}
            {!search && !searchBusy && !searchError && (
              <div className="find-empty">
                <Search size={40} />
                <h2>Search shared music</h2>
                <p>
                  Use an artist and title, or search a filename directly.
                  Compare available peers before choosing tracks.
                </p>
              </div>
            )}
            {search && (
              <>
                <div className="soulseek-row">
                  <p role="status">
                    {/Completed|TimedOut/.test(search.state)
                      ? "Search finished"
                      : /Errored/.test(search.state)
                        ? "Search failed"
                        : /Cancelled/.test(search.state)
                          ? "Search cancelled"
                          : "Searching peers…"}{" "}
                    · {search.results.length} eligible file matches ·{" "}
                    {rows.length} {nav.sourceView}
                  </p>
                  <div
                    className="soulseek-actions"
                    role="group"
                    aria-label="Result view"
                  >
                    {(["folders", "files"] as const).map((sourceView) => (
                      <Button
                        variant="ghost"
                        key={sourceView}
                        aria-pressed={nav.sourceView === sourceView}
                        onClick={() => change({ sourceView })}
                      >
                        {sourceView === "folders" ? "Folders" : "Files"}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="find-filters">
                  <label>
                    Filter results
                    <Input
                      value={nav.filter}
                      onChange={(e) => change({ filter: e.target.value })}
                      placeholder="Filename, folder, or peer"
                    />
                  </label>
                  <label>
                    Format
                    <Select
                      value={nav.format}
                      onChange={(e) => change({ format: e.target.value })}
                    >
                      <SelectItem value="">All formats</SelectItem>
                      {capabilities.allowedFormats.map((f) => (
                        <SelectItem key={f} value={f}>
                          {f.toUpperCase()}
                        </SelectItem>
                      ))}
                    </Select>
                  </label>
                  <label>
                    Minimum bitrate
                    <Input
                      type="number"
                      min="0"
                      max="100000"
                      value={nav.minBitrate}
                      onChange={(e) => change({ minBitrate: e.target.value })}
                      placeholder="kbps"
                    />
                  </label>
                  <label>
                    Sort
                    <Select
                      value={nav.sort}
                      onChange={(e) =>
                        change({
                          sort: e.target.value as FindNavigation["sort"],
                        })
                      }
                    >
                      <SelectItem value="availability">Availability</SelectItem>
                      <SelectItem value="quality">Quality</SelectItem>
                      <SelectItem value="name">Name</SelectItem>
                    </Select>
                  </label>
                  <label className="find-free">
                    <Checkbox
                      checked={nav.freeSlots}
                      onChange={(e) => change({ freeSlots: e.target.checked })}
                    />
                    Free upload slots
                  </label>
                </div>
                <div
                  className={`find-source-layout ${folder && !phone ? "has-folder" : ""}`}
                >
                  <div>
                    <div className="find-sources">
                      {rows.slice(offset, offset + 50).map((source) => {
                        const r = source.result;
                        return (
                          <article className="find-source-row" key={source.key}>
                            <div className="find-source-name">
                              <strong>
                                {fileName(
                                  nav.sourceView === "folders"
                                    ? r.folder
                                    : r.filename,
                                )}
                              </strong>
                              <small>
                                {r.username} ·{" "}
                                {nav.sourceView === "folders"
                                  ? `${source.files.length} matching files`
                                  : fileSize(r.size)}
                              </small>
                              <small>{sourceQuality(source.files)}</small>
                              <small className="soulseek-path" title={r.folder}>
                                {r.folder}
                              </small>
                            </div>
                            <div className="find-peer">
                              <span
                                className={
                                  r.hasFreeUploadSlot ? "find-available" : ""
                                }
                              >
                                {r.hasFreeUploadSlot
                                  ? "Slot available"
                                  : "Peer busy"}
                              </span>
                              <small>
                                Queue {r.queueLength} ·{" "}
                                {r.uploadSpeed
                                  ? `${Math.round(r.uploadSpeed / 1024)} KiB/s`
                                  : "Speed unknown"}
                              </small>
                            </div>
                            <div className="soulseek-actions">
                              {nav.sourceView === "files" && (
                                <Button
                                  variant="outline"
                                  disabled={downloadBusy}
                                  onClick={() => void download(r, [r.filename])}
                                >
                                  Request song
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                onClick={() => void openFolder(r)}
                              >
                                View folder
                              </Button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                    {!rows.length && (
                      <p>
                        {search.results.length
                          ? "No results match these filters. Adjust or clear your filters."
                          : /Completed|TimedOut/.test(search.state)
                            ? "No audio results match the download policy. Try another artist or title."
                            : "Waiting for peer results…"}
                      </p>
                    )}
                    <div className="soulseek-actions">
                      <Button
                        variant="ghost"
                        disabled={!offset}
                        onClick={() => setOffset((v) => Math.max(0, v - 50))}
                      >
                        Previous sources
                      </Button>
                      <span>Page {Math.floor(offset / 50) + 1}</span>
                      <Button
                        variant="ghost"
                        disabled={offset + 50 >= rows.length}
                        onClick={() => setOffset((v) => v + 50)}
                      >
                        Next sources
                      </Button>
                    </div>
                  </div>
                  {folder && !phone && (
                    <aside
                      className="find-folder-panel"
                      aria-label="Folder contents"
                    >
                      {folderContent}
                    </aside>
                  )}
                </div>
              </>
            )}
            {folderBusy && <p role="status">Loading folder contents…</p>}
            {folderError && (
              <p role="alert">{folderError} Choose View folder to retry.</p>
            )}
          </>
        )}
      </div>
      <div hidden={nav.tab !== "downloads"}>
        {capabilities.allowed ? (
          <SoulseekRequests admin={admin} revision={revision} />
        ) : (
          <p>Download access is required to view requests.</p>
        )}
      </div>
      {phone && (
        <Dialog
          open={!!folder && nav.tab === "direct" && active}
          onOpenChange={(open) => {
            if (!open) closeFolder();
          }}
        >
          <DialogContent
            className="find-folder-dialog soulseek"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              folderTrigger.current?.focus();
            }}
          >
            {folderContent}
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
