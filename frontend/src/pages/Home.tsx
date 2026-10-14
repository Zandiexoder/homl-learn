import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Header } from "../components/Header";
import { Icon } from "../components/Icon";
import { api, type Notebook, type SettingsResponse } from "../lib/api";

const ART = [
  { bg: "var(--accent-soft)", a: "var(--accent)", b: "var(--accent-mid)" },
  { bg: "var(--amber-soft)", a: "var(--amber)", b: "#e9b788" },
  { bg: "#dce8f5", a: "#1f4e86", b: "#9db8d9" },
];

type Health = { renderer: boolean; llm: boolean; voice: string; embeddings: string };

export function Home() {
  const [notebooks, setNotebooks] = useState<Notebook[] | null>(null);
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api<Notebook[]>("/notebooks").then(setNotebooks);
    api<SettingsResponse>("/settings").then(setSettings);
    api<Health>("/health").then(setHealth).catch(() => {});
  }, []);

  const shown = useMemo(
    () => (notebooks ?? []).filter((n) => n.title.toLowerCase().includes(query.toLowerCase())),
    [notebooks, query],
  );

  async function create() {
    const nb = await api<Notebook>("/notebooks", { body: {} });
    navigate(`/notebooks/${nb.id}`);
  }

  async function lock() {
    await api("/auth/logout", { body: {} });
    window.location.reload();
  }

  const s = settings?.settings;
  const chatRole = s?.roles.chat;
  const chatConn = chatRole ? s?.connections[chatRole.connection] : undefined;
  const voicePreset = settings?.presets.voice.find((p) => p.id === s?.voice.preset);

  return (
    <div className="app">
      <Header
        right={
          <>
            <span className="mono small muted">Self-hosted · data stays on this server</span>
            <button className="btn sm" onClick={lock}>
              <Icon name="lock" size={14} /> Lock
            </button>
          </>
        }
      />
      <main className="home">
        <div className="row wrap" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
          <div>
            <h1>Your notebooks</h1>
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 15 }}>
              Bring sources in. Ask questions. Turn them into podcasts, videos and study material.
            </p>
          </div>
          <div className="row wrap">
            <label className="row input" style={{ width: 240 }}>
              <Icon name="search" size={16} />
              <span className="sr-only">Search notebooks</span>
              <input type="search" placeholder="Search notebooks" value={query} onChange={(e) => setQuery(e.target.value)}
                style={{ border: 0, outline: 0, background: "transparent", flex: 1, minWidth: 0 }} />
            </label>
            <button className="btn primary" onClick={create}>
              <Icon name="plus" size={16} /> New notebook
            </button>
          </div>
        </div>

        {chatConn === undefined && settings && (
          <div className="card row wrap" style={{ justifyContent: "space-between", background: "var(--amber-soft)", borderColor: "transparent" }}>
            <span>Connect a language model to start. Any provider works, cloud or local.</span>
            <Link className="btn amber" to="/settings">Open settings</Link>
          </div>
        )}

        <div className="nb-grid">
          {shown.map((nb, i) => {
            const art = ART[i % ART.length];
            const bits = [
              `${nb.source_count ?? 0} source${nb.source_count === 1 ? "" : "s"}`,
              nb.audio_count ? `${nb.audio_count} audio` : null,
              nb.video_count ? `${nb.video_count} video` : null,
              nb.studio_count ? `${nb.studio_count} studio` : null,
            ].filter(Boolean);
            return (
              <Link key={nb.id} to={`/notebooks/${nb.id}`} className="nb-card">
                <div className="nb-art" style={{ background: art.bg }} aria-hidden="true">
                  <span style={{ width: 22, height: 22, borderRadius: i % 2 ? 6 : 11, background: art.a }} />
                  <span style={{ width: 34 + (i % 3) * 10, height: 12, borderRadius: 6, background: art.b }} />
                </div>
                <h2>{nb.title}</h2>
                <div className="mono small muted" style={{ marginTop: "auto" }}>{bits.join(" · ")}</div>
              </Link>
            );
          })}
          <button className="nb-new" onClick={create}>
            <span className="icon-btn" style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "50%", width: 48, height: 48 }}>
              <Icon name="plus" size={20} />
            </span>
            <span style={{ fontWeight: 600, fontSize: 15 }}>Create a notebook</span>
            <span className="muted" style={{ fontSize: 13 }}>Drop PDFs, links, audio or text</span>
          </button>
        </div>

        <section aria-label="Connected engines" className="engine-grid">
          <div className="panel" style={{ padding: 16 }}>
            <div className="kicker">Language model</div>
            <div style={{ fontWeight: 600 }}>{chatConn ? `${chatConn.name} · ${chatRole?.model}` : "Not set up"}</div>
            <div className="small" style={{ color: chatConn ? "var(--accent-ink)" : "var(--muted)" }}>{chatConn ? "Configured" : "Add one in Settings"}</div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div className="kicker">Voice</div>
            <div style={{ fontWeight: 600 }}>{voicePreset ? `${voicePreset.name} (${voicePreset.location})` : "Not set up"}</div>
            <div className="small muted">{voicePreset?.kind === "elevenlabs" ? "ElevenLabs-compatible API" : "OpenAI-compatible speech API"}</div>
          </div>
          <div className="panel" style={{ padding: 16 }}>
            <div className="kicker">Video renderer</div>
            <div style={{ fontWeight: 600 }}>Remotion</div>
            <div className="small" style={{ color: health?.renderer ? "var(--accent-ink)" : "var(--danger)" }}>
              {health === null ? "Checking…" : health.renderer ? "Reachable" : "Not reachable"}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
