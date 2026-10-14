import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Artifact, type Note } from "../lib/api";
import { ArtifactViewer } from "./ArtifactViewer";
import { AudioPlayer } from "./AudioPlayer";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";

type Kind = { kind: string; label: string; sub?: string };
const MAIN: Kind[] = [
  { kind: "audio", label: "Audio Overview", sub: "Two-host podcast" },
  { kind: "video", label: "Video Overview", sub: "Animated explainer" },
];
const MORE: Kind[] = [
  { kind: "mindmap", label: "Mind map" },
  { kind: "report", label: "Reports" },
  { kind: "slides", label: "Slide deck" },
  { kind: "infographic", label: "Infographic" },
  { kind: "flashcards", label: "Flashcards" },
  { kind: "quiz", label: "Quiz" },
  { kind: "timeline", label: "Timeline" },
  { kind: "faq", label: "FAQ" },
  { kind: "study_guide", label: "Study guide" },
  { kind: "briefing", label: "Briefing doc" },
];
const LABEL: Record<string, string> = { ...Object.fromEntries([...MAIN, ...MORE].map((k) => [k.kind, k.label])), research: "Research" };

export function StudioPanel({ notebookId, artifacts, notes, reloadArtifacts, reloadNotes, onAsk, onSourcesAdded }: {
  notebookId: string;
  artifacts: Artifact[];
  notes: Note[];
  reloadArtifacts: () => void;
  reloadNotes: () => void;
  onAsk: (question: string) => void;
  onSourcesAdded: () => void;
}) {
  const [audioId, setAudioId] = useState<string | null>(null);
  const [customize, setCustomize] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Artifact | null>(null);
  const [editing, setEditing] = useState<Note | "new" | null>(null);
  const navigate = useNavigate();
  const readyAudio = artifacts.filter((a) => a.kind === "audio" && a.status === "done");
  const currentAudio = readyAudio.find((a) => a.id === audioId) ?? readyAudio[0];

  function open(a: Artifact) {
    if (a.kind === "video") navigate(`/notebooks/${notebookId}/video/${a.id}`);
    else if (a.kind === "audio") a.status === "done" && setAudioId(a.id);
    else if (a.status === "done") setViewing(a);
  }

  return (
    <section className="panel pane-studio" aria-label="Studio">
      <h2 className="display" style={{ fontWeight: 500, fontSize: 17 }}>Studio</h2>
      <div className="studio-grid">
        {MAIN.map((k) => (
          <button key={k.kind} className={`studio-tile ${k.kind}`} onClick={() => setCustomize(k.kind)}>
            <span>{k.label}</span>
            <span className="sub">{k.sub}</span>
          </button>
        ))}
        {MORE.map((k) => (
          <button key={k.kind} className="studio-tile" onClick={() => setCustomize(k.kind)}>{k.label}</button>
        ))}
      </div>

      {currentAudio && <AudioPlayer key={currentAudio.id} artifact={currentAudio} />}

      {artifacts.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600 }}>Outputs</h3>
          {artifacts.map((a) => (
            <OutputRow key={a.id} artifact={a} onOpen={() => open(a)} onChanged={reloadArtifacts} playing={a.id === currentAudio?.id} />
          ))}
        </div>
      )}

      <div className="stack" style={{ gap: 6, borderTop: "1px solid var(--line-2)", paddingTop: 12 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ fontSize: 13, fontWeight: 600 }}>Notes</h3>
          <button className="btn sm" onClick={() => setEditing("new")}><Icon name="plus" size={14} /> Add note</button>
        </div>
        {notes.length === 0 && <p className="small muted" style={{ margin: 0 }}>Save chat answers or write your own notes.</p>}
        {notes.map((n) => (
          <button key={n.id} className="output-item" style={{ background: "var(--surface-2)", border: 0 }} onClick={() => setEditing(n)}>
            <Icon name="note" size={16} />
            <span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>{n.title}</span>
          </button>
        ))}
      </div>

      {customize && (
        <CustomizeDialog kind={customize} notebookId={notebookId} onClose={() => setCustomize(null)}
          onCreated={(a) => { reloadArtifacts(); if (a.kind === "video") navigate(`/notebooks/${notebookId}/video/${a.id}`); }} />
      )}
      {viewing && <ArtifactViewer artifact={viewing} onClose={() => setViewing(null)} onNoteSaved={reloadNotes} onAsk={onAsk} onSourcesAdded={onSourcesAdded} />}
      {editing && <NoteEditor notebookId={notebookId} note={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={reloadNotes} />}
    </section>
  );
}

function OutputRow({ artifact: a, onOpen, onChanged, playing }: { artifact: Artifact; onOpen: () => void; onChanged: () => void; playing?: boolean }) {
  const p = a.progress;
  const busy = a.status === "queued" || a.status === "running";
  const pct = p.total ? Math.round(((p.done ?? 0) / p.total) * 100) : null;
  const stageText: Record<string, string> = {
    script: "Writing the script", voices: "Recording voices", mixing: "Mixing", scenes: "Checking scene code",
    narration: "Recording narration", render: "Rendering", verify: "Checking the video",
    planning: "Planning searches", searching: "Searching the web", reading: "Reading pages", writing: "Writing the report",
  };
  async function remove(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete "${a.title}"?`)) return;
    await api(`/artifacts/${a.id}`, { method: "DELETE" });
    onChanged();
  }
  async function retry(e: React.MouseEvent) {
    e.stopPropagation();
    await api(`/artifacts/${a.id}/rerun`, { body: { start_at: "script" } });
    onChanged();
  }
  return (
    <div className="output-item" role="group" aria-label={a.title} style={playing ? { borderColor: "var(--amber)", background: "var(--amber-soft)" } : undefined}>
      <button className="grow" onClick={onOpen} disabled={busy && a.kind !== "video"}
        style={{ border: 0, background: "none", textAlign: "left", padding: 0, display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
        <span className="mono small muted">
          {LABEL[a.kind] ?? a.kind}{playing && " · in player"}
          {busy && ` · ${stageText[p.stage ?? ""] ?? "Queued"}${pct !== null ? ` ${pct}%` : ""}…`}
          {a.status === "failed" && " · failed"}
        </span>
        {busy && <div className={`progress${a.kind === "audio" ? " amber" : ""}`}><div style={{ width: `${pct ?? 8}%` }} /></div>}
        {a.status === "failed" && <span className="small" style={{ color: "var(--danger)" }}>{a.error}</span>}
      </button>
      {busy ? <span className="spinner" aria-label="Working" /> : (
        <>
          {a.status === "failed" && <button className="icon-btn" aria-label="Try again" onClick={retry}><Icon name="retry" size={16} /></button>}
          <button className="icon-btn" aria-label={`Delete ${a.title}`} onClick={remove}><Icon name="trash" size={16} /></button>
        </>
      )}
    </div>
  );
}

function CustomizeDialog({ kind, notebookId, onClose, onCreated }: { kind: string; notebookId: string; onClose: () => void; onCreated: (a: Artifact) => void }) {
  const [opts, setOpts] = useState<Record<string, unknown>>(
    kind === "audio" ? { format: "deep_dive", length: "default" }
      : kind === "video" ? { length: "standard", purpose: "explainer", palette: "deep-space" }
      : kind === "flashcards" ? { count: 20, difficulty: "medium" }
      : kind === "quiz" ? { count: 10, difficulty: "medium" }
      : kind === "slides" ? { count: 10 }
      : kind === "infographic" ? { palette: "paper" } : {},
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setOpts((o) => ({ ...o, [k]: v }));

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const a = await api<Artifact>(`/notebooks/${notebookId}/artifacts`, { body: { kind, options: opts } });
      onCreated(a);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const choice = (key: string, label: string, options: [string, string][]) => (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="field" style={{ marginBottom: 6 }}>{label}</legend>
      <div className="tabs">
        {options.map(([v, l]) => (
          <button key={v} type="button" className="tab" aria-pressed={opts[key] === v} onClick={() => set(key, v)}>{l}</button>
        ))}
      </div>
    </fieldset>
  );

  return (
    <Dialog title={`Customize ${LABEL[kind]}`} onClose={onClose}>
      {kind === "audio" && (
        <>
          {choice("format", "Format", [["deep_dive", "Deep dive"], ["brief", "Brief"], ["critique", "Critique"], ["debate", "Debate"]])}
          {opts.format !== "brief" && choice("length", "Length", [["short", "Shorter"], ["default", "Default"], ["long", "Longer"]])}
        </>
      )}
      {kind === "video" && (
        <>
          {choice("length", "Length", [["brief", "Brief, 2–3 min"], ["standard", "Standard, 5–7 min"], ["long", "Long, ~10 min"]])}
          {choice("purpose", "Purpose", [["explainer", "General explainer"], ["revision", "Exam revision"]])}
          {choice("palette", "Look", [["deep-space", "Deep space"], ["reef", "Reef"], ["paper", "Paper"]])}
          <label className="check">
            <input type="checkbox" checked={!!opts.check_narration} onChange={(e) => set("check_narration", e.target.checked)} />
            Double-check narration with speech to text (slower)
          </label>
        </>
      )}
      {(kind === "flashcards" || kind === "quiz") && (
        <>
          <label className="field">
            How many
            <input className="input" type="number" min={3} max={60} value={opts.count as number} onChange={(e) => set("count", Number(e.target.value))} />
          </label>
          {choice("difficulty", "Difficulty", [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]])}
        </>
      )}
      {kind === "slides" && (
        <label className="field">
          Number of slides
          <input className="input" type="number" min={4} max={30} value={opts.count as number} onChange={(e) => set("count", Number(e.target.value))} />
        </label>
      )}
      {kind === "infographic" && choice("palette", "Look", [["paper", "Paper"], ["deep-space", "Deep space"], ["reef", "Reef"]])}
      {kind === "report" && (
        <label className="field">
          What should the report be?
          <textarea className="textarea" rows={3} placeholder="e.g. A blog post for beginners, or a technical summary with a comparison table"
            value={(opts.prompt as string) ?? ""} onChange={(e) => set("prompt", e.target.value)} />
        </label>
      )}
      <label className="field">
        {kind === "audio" ? "What should the hosts focus on?" : "Focus (optional)"}
        <textarea className="textarea" rows={2} placeholder="e.g. Only the parts about the electron transport chain"
          value={(opts.focus as string) ?? ""} onChange={(e) => set("focus", e.target.value)} />
      </label>
      <label className="field">
        Language (optional)
        <input className="input" placeholder="English" value={(opts.language as string) ?? ""} onChange={(e) => set("language", e.target.value)} />
      </label>
      {error && <div className="error-box" role="alert">{error}</div>}
      <button className={`btn ${kind === "audio" ? "amber" : "accent"}`} disabled={busy} onClick={create}>Generate</button>
    </Dialog>
  );
}

function NoteEditor({ notebookId, note, onClose, onSaved }: { notebookId: string; note: Note | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(note?.title ?? "");
  const [content, setContent] = useState(note?.content ?? "");
  const [preview, setPreview] = useState(!!note);

  async function save() {
    const body = { title: title || "Untitled note", content };
    if (note) await api(`/notes/${note.id}`, { method: "PUT", body });
    else await api(`/notebooks/${notebookId}/notes`, { body });
    onSaved();
    onClose();
  }

  async function remove() {
    if (!note || !confirm("Delete this note?")) return;
    await api(`/notes/${note.id}`, { method: "DELETE" });
    onSaved();
    onClose();
  }

  async function addAsSource() {
    await api(`/notebooks/${notebookId}/sources/text`, { body: { title: title || "Note", text: content } });
    onClose();
  }

  return (
    <Dialog title={note ? "Note" : "New note"} onClose={onClose} wide>
      <label className="field">
        Title
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="tabs">
        <button className="tab" aria-pressed={!preview} onClick={() => setPreview(false)}>Edit</button>
        <button className="tab" aria-pressed={preview} onClick={() => setPreview(true)}>Preview</button>
      </div>
      {preview ? <div className="card"><Markdown text={content || "*Empty*"} /></div> : (
        <textarea className="textarea" rows={14} value={content} onChange={(e) => setContent(e.target.value)} aria-label="Note text" />
      )}
      <div className="row wrap">
        <button className="btn primary" onClick={save}>Save</button>
        {note && <button className="btn" onClick={addAsSource}>Use as a source</button>}
        <div className="spacer" />
        {note && <button className="btn danger" onClick={remove}><Icon name="trash" size={16} /> Delete</button>}
      </div>
    </Dialog>
  );
}
