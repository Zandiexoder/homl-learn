import { useEffect, useRef, useState } from "react";
import { api, type Source } from "../lib/api";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";

const BADGE: Record<string, string> = { pdf: "PDF", web: "WEB", youtube: "YT", audio: "AUD", text: "TXT", "file-text": "TXT", docx: "DOC" };
const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.csv,.json,.html,.htm,.srt,.vtt,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac,.webm,.mp4,.mkv,.mov";

export function SourcesPanel({ notebookId, sources, reload, focusId }: {
  notebookId: string;
  sources: Source[];
  reload: () => void;
  focusId?: string | null;
}) {
  const [adding, setAdding] = useState(sources.length === 0);
  const [viewing, setViewing] = useState<string | null>(null);
  const [discoverQ, setDiscoverQ] = useState("");
  const [discovering, setDiscovering] = useState(false);

  useEffect(() => {
    if (focusId) setViewing(focusId);
  }, [focusId]);

  const allSelected = sources.length > 0 && sources.every((s) => s.selected);

  async function toggle(s: Source) {
    await api(`/sources/${s.id}`, { method: "PATCH", body: { selected: !s.selected } });
    reload();
  }

  async function toggleAll() {
    await api(`/notebooks/${notebookId}/sources/select`, { body: { selected: !allSelected } });
    reload();
  }

  return (
    <section className="panel pane-sources" aria-label="Sources">
      <div className="panel-head">
        <h2>Sources</h2>
        <span className="mono small muted">{sources.filter((s) => s.selected).length} of {sources.length} selected</span>
      </div>
      <div className="stack" style={{ padding: "0 16px 12px", gap: 8 }}>
        <button className="btn block" style={{ borderStyle: "dashed", borderWidth: 1.5, background: "var(--surface-2)" }} onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} /> Add source
        </button>
        <form className="row input" onSubmit={(e) => { e.preventDefault(); if (discoverQ.trim()) setDiscovering(true); }}>
          <Icon name="search" size={16} />
          <span className="sr-only">Discover sources on the web</span>
          <input type="search" placeholder="Discover sources on the web" value={discoverQ} onChange={(e) => setDiscoverQ(e.target.value)}
            style={{ border: 0, outline: 0, background: "transparent", flex: 1, minWidth: 0, fontSize: 13 }} />
        </form>
      </div>
      {sources.length > 0 && (
        <label className="check" style={{ padding: "8px 16px", borderTop: "1px solid var(--line-2)", color: "var(--muted)" }}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          Select all sources
        </label>
      )}
      <ul className="source-list">
        {sources.map((s) => (
          <li key={s.id} className={`source-item${viewing === s.id ? " active" : ""}`}>
            <span className={`badge ${s.kind}`} aria-hidden="true">{BADGE[s.kind] ?? "SRC"}</span>
            <button className="source-title" onClick={() => setViewing(s.id)} title={s.title}>
              {s.title}
              {s.status !== "ready" && (
                <span className="row small" style={{ color: s.status === "failed" ? "var(--danger)" : "var(--muted)", whiteSpace: "normal" }}>
                  {s.status === "failed" ? s.error ?? "Failed" : <><span className="spinner" /> {s.status === "queued" ? "Waiting" : "Reading"}…</>}
                </span>
              )}
            </button>
            <input type="checkbox" aria-label={`Use ${s.title}`} checked={!!s.selected} onChange={() => toggle(s)}
              style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
          </li>
        ))}
      </ul>
      {sources.length === 0 && <p className="muted small" style={{ padding: "0 16px" }}>Add PDFs, web pages, YouTube links, audio or notes to get started.</p>}

      {adding && <AddSourceDialog notebookId={notebookId} onClose={() => setAdding(false)} onAdded={reload} />}
      {viewing && <SourceViewer id={viewing} onClose={() => setViewing(null)} onChanged={reload} />}
      {discovering && (
        <DiscoverDialog notebookId={notebookId} query={discoverQ} onClose={() => setDiscovering(false)} onAdded={reload} />
      )}
    </section>
  );
}

function AddSourceDialog({ notebookId, onClose, onAdded }: { notebookId: string; onClose: () => void; onAdded: () => void }) {
  const [tab, setTab] = useState<"upload" | "link" | "text">("upload");
  const [over, setOver] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onAdded();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    const form = new FormData();
    Array.from(files).forEach((f) => form.append("files", f));
    run(() => api(`/notebooks/${notebookId}/sources/upload`, { form }));
  };

  return (
    <Dialog title="Add sources" onClose={onClose}>
      <div className="tabs" role="tablist">
        {(["upload", "link", "text"] as const).map((t) => (
          <button key={t} role="tab" className="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {{ upload: "Upload files", link: "Website or YouTube", text: "Paste text" }[t]}
          </button>
        ))}
      </div>
      {tab === "upload" && (
        <div className={`drop${over ? " over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}>
          <p style={{ margin: "0 0 12px", fontWeight: 600 }}>Drop files here</p>
          <p className="muted small" style={{ margin: "0 0 16px" }}>PDF, Word, Markdown, text, audio and video (transcribed). Up to 500 MB each.</p>
          <input ref={fileRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => upload(e.target.files)} />
          <button className="btn primary" disabled={busy} onClick={() => fileRef.current?.click()}>Choose files</button>
        </div>
      )}
      {tab === "link" && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); run(() => api(`/notebooks/${notebookId}/sources/link`, { body: { url } })); }}>
          <label className="field">
            Link
            <input className="input" type="url" required placeholder="https://… or a YouTube link" value={url} onChange={(e) => setUrl(e.target.value)} />
            <span className="hint">Web pages are read as articles. YouTube links use the video's transcript.</span>
          </label>
          <button className="btn primary" disabled={busy || !url}>Add link</button>
        </form>
      )}
      {tab === "text" && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); run(() => api(`/notebooks/${notebookId}/sources/text`, { body: { title, text } })); }}>
          <label className="field">
            Title
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My notes" />
          </label>
          <label className="field">
            Text
            <textarea className="textarea" rows={10} required value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <button className="btn primary" disabled={busy || !text.trim()}>Add text</button>
        </form>
      )}
      {busy && <div className="row muted"><span className="spinner" /> Uploading…</div>}
      {error && <div className="error-box" role="alert">{error}</div>}
    </Dialog>
  );
}

function SourceViewer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [source, setSource] = useState<Source | null>(null);
  useEffect(() => {
    api<Source>(`/sources/${id}`).then(setSource);
  }, [id]);
  if (!source) return null;

  async function remove() {
    if (!confirm(`Remove "${source!.title}" from this notebook?`)) return;
    await api(`/sources/${id}`, { method: "DELETE" });
    onChanged();
    onClose();
  }

  async function retry() {
    await api(`/sources/${id}/retry`, { body: {} });
    onChanged();
    onClose();
  }

  return (
    <Dialog title={source.title} onClose={onClose} wide>
      {source.uri && <a href={source.uri} target="_blank" rel="noreferrer" className="small">{source.uri}</a>}
      {source.error && <div className="error-box">{source.error}</div>}
      {source.summary && (
        <div className="card">
          <div className="kicker">Source guide</div>
          <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{source.summary}</p>
        </div>
      )}
      {source.text && <pre className="quote" style={{ maxHeight: "50vh", overflow: "auto", fontFamily: "var(--body)" }}>{source.text}</pre>}
      <div className="row">
        {source.status === "failed" && <button className="btn" onClick={retry}><Icon name="retry" size={16} /> Try again</button>}
        <div className="spacer" />
        <button className="btn danger" onClick={remove}><Icon name="trash" size={16} /> Remove source</button>
      </div>
    </Dialog>
  );
}

type Hit = { title: string; url: string; snippet: string };

function DiscoverDialog({ notebookId, query, onClose, onAdded }: { notebookId: string; query: string; onClose: () => void; onAdded: () => void }) {
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    api<Hit[]>(`/discover?q=${encodeURIComponent(query)}`).then(setHits).catch((e) => setError(e.message));
  }, [query]);

  async function add() {
    for (const url of picked) await api(`/notebooks/${notebookId}/sources/link`, { body: { url } });
    onAdded();
    onClose();
  }

  return (
    <Dialog title={`Sources for "${query}"`} onClose={onClose} wide>
      {error && <div className="error-box">{error}</div>}
      {!hits && !error && <div className="row muted"><span className="spinner" /> Searching…</div>}
      {hits?.length === 0 && <p className="muted">No results.</p>}
      <div className="stack" style={{ gap: 8 }}>
        {hits?.map((h) => (
          <label key={h.url} className="card row" style={{ alignItems: "flex-start", gap: 12 }}>
            <input type="checkbox" style={{ width: 18, height: 18, marginTop: 3, accentColor: "var(--accent)" }} checked={picked.has(h.url)}
              onChange={() => setPicked((p) => { const n = new Set(p); n.has(h.url) ? n.delete(h.url) : n.add(h.url); return n; })} />
            <span className="grow">
              <span style={{ fontWeight: 600, display: "block" }}>{h.title}</span>
              <span className="small muted" style={{ display: "block", overflowWrap: "anywhere" }}>{h.url}</span>
              <span className="small">{h.snippet}</span>
            </span>
          </label>
        ))}
      </div>
      {hits && hits.length > 0 && <button className="btn primary" disabled={!picked.size} onClick={add}>Add {picked.size || ""} selected</button>}
    </Dialog>
  );
}
