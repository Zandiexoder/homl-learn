import { useEffect, useState } from "react";
import { Header } from "../components/Header";
import { Icon } from "../components/Icon";
import { api, type Connection, type Preset, type Settings, type SettingsResponse, type Voice } from "../lib/api";

type Status = { kind: "ok" | "error"; text: string } | null;

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return <div className={status.kind === "ok" ? "ok-box" : "error-box"} role="status">{status.text}</div>;
}

function PresetGrid({ presets, value, onPick, tone }: { presets: Preset[]; value: string; onPick: (p: Preset) => void; tone?: "amber" }) {
  return (
    <div role="radiogroup" className="preset-grid">
      {presets.map((p) => (
        <button key={p.id} type="button" role="radio" aria-checked={value === p.id} className={`preset${tone ? " " + tone : ""}`} onClick={() => onPick(p)}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</span>
          <span className="k">{p.location}</span>
        </button>
      ))}
    </div>
  );
}

export function SettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  useEffect(() => {
    api<SettingsResponse>("/settings").then(setData);
  }, []);
  if (!data) return null;

  const save = async (patch: Partial<Settings> | Record<string, unknown>) => {
    const res = await api<SettingsResponse>("/settings", { method: "PUT", body: patch });
    setData(res);
    return res;
  };

  return (
    <div className="app">
      <Header>
        <span className="crumb" aria-hidden="true">/</span>
        <h1>Settings</h1>
      </Header>
      <div className="settings">
        <nav aria-label="Settings sections">
          <a href="#models">Language models</a>
          <a href="#voice">Voice</a>
          <a href="#stt">Speech to text</a>
          <a href="#retrieval">Search and embeddings</a>
          <a href="#video">Video</a>
          <a href="#security">Password</a>
        </nav>
        <div className="settings-main">
          <ModelsSection data={data} save={save} />
          <VoiceSection data={data} save={save} />
          <SttSection data={data} save={save} />
          <RetrievalSection data={data} save={save} />
          <VideoSection data={data} save={save} />
          <PasswordSection />
        </div>
      </div>
    </div>
  );
}

type SectionProps = { data: SettingsResponse; save: (patch: Record<string, unknown>) => Promise<SettingsResponse> };

// ------------------------------------------------------------------ language models

function ModelsSection({ data, save }: SectionProps) {
  const { settings, presets } = data;
  const conns = settings.connections;
  const [editingId, setEditingId] = useState<string | null>(Object.keys(conns)[0] ?? null);
  const [draft, setDraft] = useState<Connection & { id: string; api_key: string; model: string }>(() => draftFor(editingId));
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  function draftFor(id: string | null) {
    const c = id ? conns[id] : undefined;
    const p = presets.llm[0];
    return c
      ? { id: id!, ...c, api_key: "", model: settings.roles.chat?.connection === id ? settings.roles.chat.model : c.model ?? "" }
      : { id: p.id, preset: p.id, name: p.name, kind: p.kind, base_url: p.base_url, api_key: "", model: p.model ?? "" };
  }

  function pickPreset(p: Preset) {
    let id = p.id;
    if (p.id === "custom") for (let n = 1; conns[id]; n++) id = `custom-${n}`;
    const existing = conns[id];
    setEditingId(existing ? id : null);
    setDraft(existing ? draftFor(id) : { id, preset: p.id, name: p.name, kind: p.kind, base_url: p.base_url, api_key: "", model: p.model ?? "" });
    setModels([]);
    setStatus(null);
  }

  const connBody = () => ({ connection_id: editingId, kind: draft.kind, base_url: draft.base_url, api_key: draft.api_key || null, name: draft.name });

  async function loadModels() {
    setStatus(null);
    try {
      const r = await api<{ models: string[] }>("/llm/models", { body: connBody() });
      setModels(r.models);
      setStatus({ kind: "ok", text: `Found ${r.models.length} models.` });
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    }
  }

  async function test() {
    setBusy(true);
    setStatus(null);
    try {
      const r = await api<{ reply: string }>("/llm/test", { body: { ...connBody(), model: draft.model } });
      setStatus({ kind: "ok", text: `Connected. The model replied: “${r.reply}”` });
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function saveConn() {
    const { id, api_key, model, has_key: _ignored, ...rest } = draft;
    void _ignored;
    const nextConns: Record<string, unknown> = { ...conns };
    nextConns[id] = { ...rest, model, ...(api_key ? { api_key } : {}) };
    const patch: Record<string, unknown> = { connections: nextConns };
    // The first connection becomes the default for every task.
    if (!Object.keys(conns).length || !settings.roles.chat?.connection) {
      patch.roles = Object.fromEntries(["chat", "studio", "video"].map((r) => [r, { connection: id, model }]));
    }
    await save(patch);
    setEditingId(id);
    setDraft((d) => ({ ...d, api_key: "" }));
    setStatus({ kind: "ok", text: "Saved." });
  }

  async function remove(id: string) {
    if (!confirm(`Remove the ${conns[id].name} connection?`)) return;
    const next = { ...conns };
    delete next[id];
    await save({ connections: next });
    setEditingId(null);
  }

  async function setRole(role: string, field: "connection" | "model", value: string) {
    const current = settings.roles[role] ?? { connection: "", model: "" };
    const next = { ...current, [field]: value };
    if (field === "connection") next.model = conns[value]?.model ?? "";
    await save({ roles: { [role]: next } });
  }

  const preset = presets.llm.find((p) => p.id === draft.preset);
  return (
    <section id="models" className="section">
      <div>
        <h2>Language models</h2>
        <p className="muted" style={{ margin: "4px 0 0" }}>Pick a preset or point at any OpenAI-compatible endpoint. Keys stay on this server, encrypted at rest.</p>
      </div>
      {Object.keys(conns).length > 0 && (
        <div className="row wrap">
          {Object.entries(conns).map(([id, c]) => (
            <span key={id} className="chip" style={{ paddingRight: 4 }}>
              <button style={{ border: 0, background: "none", padding: 0 }} onClick={() => { setEditingId(id); setDraft(draftFor(id)); setStatus(null); }}>
                <strong>{c.name}</strong> <span className="muted small">{c.has_key ? "key saved" : "no key"}</span>
              </button>
              <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label={`Remove ${c.name}`} onClick={() => remove(id)}><Icon name="close" size={14} /></button>
            </span>
          ))}
        </div>
      )}
      <PresetGrid presets={presets.llm} value={draft.preset} onPick={pickPreset} />
      <div className="card form-grid">
        <label className="field">Name
          <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="field">Base URL
          <input className="input mono" value={draft.base_url} onChange={(e) => setDraft({ ...draft, base_url: e.target.value })} placeholder="https://…/v1" />
        </label>
        <label className="field">API key {preset?.needs_key === false && <span className="hint">(often not needed for local servers)</span>}
          <input className="input mono" type="password" autoComplete="off" value={draft.api_key} placeholder={draft.has_key ? "Saved — type to replace" : ""}
            onChange={(e) => setDraft({ ...draft, api_key: e.target.value })} />
        </label>
        <label className="field">Default model
          <div className="row">
            <input className="input mono" list="llm-models" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
            <button type="button" className="btn" onClick={loadModels}>List</button>
          </div>
          <datalist id="llm-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        {draft.kind === "openai" && draft.preset === "custom" && (
          <label className="field">Protocol
            <select className="select" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
              <option value="openai">OpenAI-compatible</option>
              <option value="anthropic">Anthropic Messages API</option>
            </select>
          </label>
        )}
        <div className="row" style={{ alignItems: "flex-end" }}>
          <button className="btn" onClick={test} disabled={busy || !draft.model}>{busy ? "Testing…" : "Test"}</button>
          <button className="btn accent" onClick={saveConn}>Save connection</button>
        </div>
      </div>
      <StatusLine status={status} />

      <div>
        <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Model per task</h3>
        <div className="table-wrap">
          <table className="plain">
            <thead><tr><th>Task</th><th>Connection</th><th>Model</th></tr></thead>
            <tbody>
              {[["chat", "Chat with citations, notebook summary"], ["studio", "Studio outputs and podcast scripts"], ["video", "Video script and scenes (follows SKILL.md)"]].map(([role, label]) => (
                <tr key={role}>
                  <td>{label}</td>
                  <td>
                    <select className="select" aria-label={`${label} connection`} value={settings.roles[role]?.connection ?? ""} onChange={(e) => setRole(role, "connection", e.target.value)}>
                      <option value="">Choose…</option>
                      {Object.entries(conns).map(([id, c]) => <option key={id} value={id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <input className="input mono" aria-label={`${label} model`} list="llm-models" defaultValue={settings.roles[role]?.model ?? ""}
                      key={`${role}-${settings.roles[role]?.connection}`} onBlur={(e) => e.target.value !== settings.roles[role]?.model && setRole(role, "model", e.target.value)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ voice

function VoiceSection({ data, save }: SectionProps) {
  const { settings, presets } = data;
  const [v, setV] = useState({ ...settings.voice, api_key: "" });
  const [voices, setVoices] = useState<Voice[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [status, setStatus] = useState<Status>(null);
  const preset = presets.voice.find((p) => p.id === v.preset);

  function pick(p: Preset) {
    setV({ ...v, preset: p.id, kind: p.kind, base_url: p.base_url || (p.id === v.preset ? v.base_url : ""), model_id: p.model_id ?? "", api_key: "" });
    setVoices([]);
    setProjects([]);
    setStatus(null);
  }

  async function persist() {
    const { has_key: _h, ...rest } = v;
    void _h;
    await save({ voice: { ...rest, api_key: v.api_key || null } });
    setV((x) => ({ ...x, api_key: "", has_key: x.has_key || !!x.api_key }));
  }

  async function saveAndLoad() {
    setStatus(null);
    try {
      await persist();
      const r = await api<{ voices: Voice[] }>("/voice/voices");
      setVoices(r.voices);
      if (preset?.projects) {
        const p = await api<{ projects: { id: string; name: string }[] }>("/voice/projects").catch(() => ({ projects: [] }));
        setProjects(p.projects);
      }
      setStatus({ kind: "ok", text: `Saved. ${r.voices.length} voices available.` });
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    }
  }

  async function previewVoice(voiceId: string) {
    try {
      const blob = await api<Blob>("/voice/preview", { body: { voice_id: voiceId } });
      new Audio(URL.createObjectURL(blob)).play();
    } catch (e) {
      setStatus({ kind: "error", text: (e as Error).message });
    }
  }

  const voicePicker = (field: "host_a" | "host_b" | "narrator", label: string) => (
    <div className="card stack" style={{ gap: 8 }}>
      <label htmlFor={`voice-${field}`} className="kicker">{label}</label>
      <div className="row">
        {voices.length ? (
          <select id={`voice-${field}`} className="select" value={v[field]} onChange={(e) => setV({ ...v, [field]: e.target.value })}>
            {!voices.some((x) => x.id === v[field]) && <option value={v[field]}>{v[field] || "Choose…"}</option>}
            {voices.map((x) => <option key={x.id} value={x.id}>{x.name}{x.detail ? ` (${x.detail})` : ""}</option>)}
          </select>
        ) : (
          <input id={`voice-${field}`} className="input mono" value={v[field]} placeholder="voice id" onChange={(e) => setV({ ...v, [field]: e.target.value })} />
        )}
        <button className="icon-btn" style={{ border: "1px solid var(--line)" }} aria-label={`Preview ${label}`} onClick={() => previewVoice(v[field])} disabled={!v[field]}>
          <Icon name="play" size={14} />
        </button>
      </div>
    </div>
  );

  return (
    <section id="voice" className="section">
      <div>
        <h2>Voice</h2>
        <p className="muted" style={{ margin: "4px 0 0" }}>Any server that speaks the ElevenLabs API works, including your 10labs server. ElevenLabs itself is one option.</p>
      </div>
      <PresetGrid presets={presets.voice} value={v.preset} onPick={pick} tone="amber" />
      {preset?.note && <p className="small muted" style={{ margin: 0 }}>{preset.note}</p>}
      <div className="form-grid">
        <label className="field">Server URL
          <input className="input mono" value={v.base_url} placeholder={v.preset === "10labs" ? "https://your-10labs-server" : ""} onChange={(e) => setV({ ...v, base_url: e.target.value })} />
        </label>
        <label className="field">{v.kind === "elevenlabs" ? "API key (xi-api-key)" : "API key"} {preset?.needs_key === false && <span className="hint">(optional for local)</span>}
          <input className="input mono" type="password" autoComplete="off" value={v.api_key} placeholder={v.has_key ? "Saved — type to replace" : v.preset === "10labs" ? "tl_live_…" : ""}
            onChange={(e) => setV({ ...v, api_key: e.target.value })} />
        </label>
        <label className="field">Model {v.preset === "10labs" && <span className="hint">(blank = server default)</span>}
          <input className="input mono" value={v.model_id} onChange={(e) => setV({ ...v, model_id: e.target.value })} placeholder={v.kind === "elevenlabs" ? "e.g. chatterbox, xtts-v2" : "e.g. kokoro"} />
        </label>
        {preset?.projects && (
          <label className="field">Project
            <input className="input mono" list="voice-projects" value={v.project} placeholder="blank = the key's default project" onChange={(e) => setV({ ...v, project: e.target.value })} />
            <datalist id="voice-projects">{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</datalist>
            <span className="hint">Clips and transcripts from Homl Learn are filed under this 10labs project.</span>
          </label>
        )}
        {v.kind === "elevenlabs" && (
          <label className="field">Language code <span className="hint">(for multilingual models, e.g. es)</span>
            <input className="input mono" value={v.language_code} onChange={(e) => setV({ ...v, language_code: e.target.value })} />
          </label>
        )}
      </div>
      <div className="row"><button className="btn accent" onClick={saveAndLoad}>Save and load voices</button></div>
      <StatusLine status={status} />
      <div className="form-grid">
        {voicePicker("host_a", "Host A voice")}
        {voicePicker("host_b", "Host B voice")}
        {voicePicker("narrator", "Video narrator")}
      </div>
      <div className="row"><button className="btn" onClick={() => persist().then(() => setStatus({ kind: "ok", text: "Voices saved." }))}>Save voice choices</button></div>
      {preset?.cloning && <CloneVoice onCloned={saveAndLoad} />}
    </section>
  );
}

function CloneVoice({ onCloned }: { onCloned: () => void }) {
  const [name, setName] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [consent, setConsent] = useState(false);
  const [denoise, setDenoise] = useState(true);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  async function clone(e: React.FormEvent) {
    e.preventDefault();
    if (!files?.length) return;
    const form = new FormData();
    form.append("name", name);
    form.append("consent", String(consent));
    form.append("remove_background_noise", String(denoise));
    Array.from(files).forEach((f) => form.append("files", f));
    setBusy(true);
    setStatus(null);
    try {
      const r = await api<{ id: string; status: string }>("/voice/clone", { form });
      setStatus({ kind: "ok", text: `Cloned "${name}" (${r.status}). It now appears in the voice lists.` });
      onCloned();
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" style={{ borderStyle: "dashed" }} onSubmit={clone}>
      <div>
        <div style={{ fontWeight: 600 }}>Clone a voice</div>
        <div className="small muted">Upload clean recordings of one speaker: 10 seconds minimum, 1 to 3 minutes is best.</div>
      </div>
      <div className="form-grid">
        <label className="field">Name<input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">Recordings<input className="input" type="file" accept="audio/*,video/*" multiple required onChange={(e) => setFiles(e.target.files)} style={{ paddingTop: 8 }} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={denoise} onChange={(e) => setDenoise(e.target.checked)} /> Remove background noise first</label>
      <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> This is my own voice, or I have permission to clone it</label>
      <StatusLine status={status} />
      <div className="row"><button className="btn primary" disabled={busy || !consent}>{busy ? "Cloning…" : "Clone voice"}</button></div>
    </form>
  );
}

// ------------------------------------------------------------------ speech to text

function SttSection({ data, save }: SectionProps) {
  const { settings, presets } = data;
  const [s, setS] = useState({ ...settings.stt, api_key: "" });
  const [status, setStatus] = useState<Status>(null);
  const pick = (p: Preset) => setS({ ...s, preset: p.id, kind: p.kind, base_url: p.base_url, model: p.model ?? "" });
  async function persist() {
    const { has_key: _h, ...rest } = s;
    void _h;
    await save({ stt: { ...rest, api_key: s.api_key || null } });
    setStatus({ kind: "ok", text: "Saved." });
  }
  return (
    <section id="stt" className="section">
      <div>
        <h2>Speech to text</h2>
        <p className="muted" style={{ margin: "4px 0 0" }}>Transcribes audio and video sources, voice questions in chat, and your questions in interactive podcast mode.</p>
      </div>
      <PresetGrid presets={presets.stt} value={s.preset} onPick={pick} />
      {s.kind !== "voice" && (
        <div className="form-grid">
          <label className="field">Server URL<input className="input mono" value={s.base_url} onChange={(e) => setS({ ...s, base_url: e.target.value })} /></label>
          <label className="field">API key
            <input className="input mono" type="password" autoComplete="off" value={s.api_key} placeholder={s.has_key ? "Saved — type to replace" : ""} onChange={(e) => setS({ ...s, api_key: e.target.value })} />
          </label>
          <label className="field">Model <span className="hint">(blank = server default)</span><input className="input mono" value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })} /></label>
          {s.preset === "10labs" && <label className="field">Project<input className="input mono" value={s.project} onChange={(e) => setS({ ...s, project: e.target.value })} /></label>}
        </div>
      )}
      <div className="row"><button className="btn accent" onClick={persist}>Save</button></div>
      <StatusLine status={status} />
    </section>
  );
}

// ------------------------------------------------------------------ retrieval

function RetrievalSection({ data, save }: SectionProps) {
  const { settings, presets } = data;
  const [e, setE] = useState({ ...settings.embeddings, api_key: "" });
  const [searchUrl, setSearchUrl] = useState(settings.search.base_url);
  const [status, setStatus] = useState<Status>(null);
  const pick = (p: Preset) => setE({ ...e, preset: p.id, kind: p.kind, base_url: p.base_url, model: p.model ?? "" });
  async function persist() {
    const { has_key: _h, ...rest } = e;
    void _h;
    await save({ embeddings: { ...rest, api_key: e.api_key || null }, search: { base_url: searchUrl } });
    if (e.kind === "keyword") return setStatus({ kind: "ok", text: "Saved. Using keyword search." });
    try {
      const r = await api<{ dimensions: number }>("/embeddings/test", { body: {} });
      setStatus({ kind: "ok", text: `Saved. Embeddings work (${r.dimensions} dimensions). Existing sources are being re-indexed.` });
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
    }
  }
  return (
    <section id="retrieval" className="section">
      <div>
        <h2>Search and embeddings</h2>
        <p className="muted" style={{ margin: "4px 0 0" }}>Keyword search works with no setup. Adding embeddings (for example bge-m3 in Ollama) finds passages by meaning as well.</p>
      </div>
      <PresetGrid presets={presets.embeddings} value={e.preset} onPick={pick} />
      {e.kind !== "keyword" && (
        <div className="form-grid">
          <label className="field">Base URL<input className="input mono" value={e.base_url} onChange={(x) => setE({ ...e, base_url: x.target.value })} /></label>
          <label className="field">API key
            <input className="input mono" type="password" autoComplete="off" value={e.api_key} placeholder={e.has_key ? "Saved — type to replace" : ""} onChange={(x) => setE({ ...e, api_key: x.target.value })} />
          </label>
          <label className="field">Model<input className="input mono" value={e.model} onChange={(x) => setE({ ...e, model: x.target.value })} /></label>
        </div>
      )}
      <label className="field">SearXNG URL for "Discover sources" <span className="hint">(optional; JSON output must be enabled)</span>
        <input className="input mono" value={searchUrl} placeholder="http://searxng:8080" onChange={(x) => setSearchUrl(x.target.value)} />
      </label>
      <div className="row"><button className="btn accent" onClick={persist}>Save</button></div>
      <StatusLine status={status} />
    </section>
  );
}

// ------------------------------------------------------------------ video

function VideoSection({ data, save }: SectionProps) {
  const [maxCustom, setMaxCustom] = useState(data.settings.video.max_custom_scenes);
  const [renderer, setRenderer] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>(null);
  useEffect(() => {
    api<{ renderer: boolean }>("/health").then((h) => setRenderer(h.renderer)).catch(() => setRenderer(false));
  }, []);
  return (
    <section id="video" className="section">
      <h2>Video</h2>
      <div className="form-grid">
        <div className="card">
          <div className="kicker">Instructions for the LLM</div>
          <div style={{ fontWeight: 600, marginTop: 4 }}>video-creation/SKILL.md</div>
          <div className="small muted">Bundled · flat-vector explainer style, 14 kit scenes</div>
        </div>
        <div className="card">
          <div className="kicker">Renderer</div>
          <div style={{ fontWeight: 600, marginTop: 4 }}>Remotion · headless Chromium</div>
          <div className="small" style={{ color: renderer ? "var(--accent-ink)" : "var(--danger)" }}>
            {renderer === null ? "Checking…" : renderer ? "Reachable" : "Not reachable: is the renderer container running?"}
          </div>
        </div>
        <label className="card field">Custom scenes per video
          <input className="input" type="number" min={0} max={8} value={maxCustom} onChange={(e) => setMaxCustom(Number(e.target.value))} />
          <span className="hint">LLM-written scene code is type-checked and runs in the renderer with no network. 0 = kit scenes only.</span>
        </label>
      </div>
      <div className="row"><button className="btn accent" onClick={async () => { await save({ video: { max_custom_scenes: maxCustom } }); setStatus({ kind: "ok", text: "Saved." }); }}>Save</button></div>
      <StatusLine status={status} />
    </section>
  );
}

// ------------------------------------------------------------------ password

function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [status, setStatus] = useState<Status>(null);
  async function change(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/auth/password", { body: { current, new: next } });
      setCurrent("");
      setNext("");
      setStatus({ kind: "ok", text: "Password changed. Other devices are signed out." });
    } catch (err) {
      setStatus({ kind: "error", text: (err as Error).message });
    }
  }
  return (
    <section id="security" className="section">
      <div>
        <h2>Password</h2>
        <p className="muted" style={{ margin: "4px 0 0" }}>Everything lives in the server's <span className="mono">/data</span> folder: the database, sources, audio and video. Back up that folder to keep your notebooks.</p>
      </div>
      <form className="form-grid" onSubmit={change}>
        <label className="field">Current password<input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
        <label className="field">New password<input className="input" type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required /></label>
        <div className="row" style={{ alignItems: "flex-end" }}><button className="btn primary">Change password</button></div>
      </form>
      <StatusLine status={status} />
    </section>
  );
}
