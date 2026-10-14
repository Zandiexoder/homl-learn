import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Header } from "../components/Header";
import { Icon } from "../components/Icon";
import { api, fileUrl, type Artifact } from "../lib/api";
import { usePolled } from "../lib/hooks";

type Scene = { type: string; title?: string; props: Record<string, unknown>; lines: string[]; custom?: string; code?: string };
type Spec = { title: string; palette: string; accent: string; scenes: Scene[]; report: Report };
type Report = { covered?: { point: string; scene?: number }[]; gaps?: string[]; own_wording?: string[]; words?: number; minutes_estimate?: number };
type Check = { name: string; ok: boolean; detail: string };
type VideoData = {
  spec?: Spec; video?: string; stills?: string[]; checks?: Check[]; duration?: number; subtitles?: string;
  timeline?: { start: number; lines: number[] }[]; custom_errors?: Record<string, string>;
  flagged_lines?: { scene: number; line: number; text: string; heard: string }[]; render_stage?: string;
};

const STAGES: [string, string][] = [
  ["script", "Brief and script"],
  ["scenes", "Scene code"],
  ["narration", "Narration"],
  ["render", "Render"],
  ["verify", "Verify"],
];
const PALETTES: Record<string, [string, string]> = { "deep-space": ["#1B2A4A", "#F2B33D"], reef: ["#0F5257", "#FF8C6B"], paper: ["#F1EBDD", "#2F6F9F"] };

export function VideoStudio() {
  const { id, artifactId } = useParams<{ id: string; artifactId: string }>();
  const { data: art, reload } = usePolled<Artifact>(`/artifacts/${artifactId}`, (a) => a.status === "queued" || a.status === "running");
  const [selected, setSelected] = useState(0);
  const video = useRef<HTMLVideoElement>(null);

  if (!art) return null;
  const d = art.data as VideoData;
  const spec = d.spec;
  const busy = art.status === "queued" || art.status === "running";
  const stages = art.progress.stages ?? {};
  const opts = art.options as Record<string, string>;

  function jump(i: number) {
    setSelected(i);
    const t = d.timeline?.[i]?.start;
    if (video.current && t !== undefined) video.current.currentTime = t + 0.05;
  }

  async function rerun(start_at: string) {
    await api(`/artifacts/${art!.id}/rerun`, { body: { start_at } });
    reload();
  }

  return (
    <div className="app">
      <Header right={d.video && <a className="btn" href={fileUrl(d.video)} download><Icon name="download" size={16} /> Download MP4</a>}>
        <Link to={`/notebooks/${id}`} className="btn ghost"><Icon name="back" size={16} /> Notebook</Link>
        <span className="crumb" aria-hidden="true">/</span>
        <h1>Video Overview: {art.title}</h1>
      </Header>
      <main className="video-wrap">
        <section className="panel brief stack" aria-label="Brief" style={{ padding: 18 }}>
          <h2 className="display" style={{ fontWeight: 500, fontSize: 17 }}>Brief</h2>
          <dl className="stack" style={{ margin: 0, gap: 10 }}>
            <div><dt className="kicker">Length</dt><dd style={{ margin: 0 }}>{{ brief: "Brief, 2–3 min", standard: "Standard, 5–7 min", long: "Long, ~10 min" }[opts.length] ?? "Standard"}</dd></div>
            <div><dt className="kicker">Purpose</dt><dd style={{ margin: 0 }}>{opts.purpose === "revision" ? "Exam revision" : "General explainer"}</dd></div>
            {opts.focus && <div><dt className="kicker">Focus</dt><dd style={{ margin: 0 }}>{opts.focus}</dd></div>}
            <div>
              <dt className="kicker">Look</dt>
              <dd style={{ margin: "6px 0 0" }} className="row">
                <span className="palette-swatch" aria-pressed="true" style={{ background: PALETTES[opts.palette ?? "deep-space"]?.[0] }}>
                  <span style={{ background: spec?.accent ?? PALETTES[opts.palette ?? "deep-space"]?.[1] }} />
                </span>
                <span className="small muted">{opts.palette ?? "deep-space"}</span>
              </dd>
            </div>
          </dl>
          <button className="btn accent" disabled={busy} onClick={() => confirm("Write a new script from scratch? Edits to lines will be lost.") && rerun("script")}>Regenerate video</button>
          <p className="small muted" style={{ margin: 0 }}>The script model follows the bundled video-creation SKILL.md, then lays out each beat with the scene kit or its own Remotion scene.</p>
          {spec?.report && <ReportCard report={spec.report} />}
        </section>

        <section className="preview" aria-label="Preview">
          <div className="panel" style={{ padding: 12 }}>
            {d.video ? (
              <video ref={video} className="player" src={fileUrl(d.video)} poster={d.stills?.[0] ? fileUrl(d.stills[0]) : undefined} controls preload="metadata">
                {d.subtitles && <track kind="subtitles" label="Narration" srcLang="en" src={fileUrl(d.subtitles)} default />}
              </video>
            ) : (
              <div className="player" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", flexDirection: "column", gap: 12 }}>
                {art.status === "failed" ? <span>Generation failed</span> : <><span className="spinner" style={{ width: 28, height: 28 }} /><span>Making your video…</span></>}
              </div>
            )}
          </div>
          {spec && (
            <div className="panel stack" style={{ padding: 14, gap: 10 }}>
              <h2 style={{ fontSize: 14, fontWeight: 600 }}>Scenes</h2>
              <div className="scene-strip">
                {spec.scenes.map((s, i) => (
                  <button key={i} className="scene-btn" aria-pressed={selected === i} onClick={() => jump(i)}>
                    {d.stills?.[i] ? <img src={fileUrl(d.stills[i])} alt="" /> : <span className="player" style={{ aspectRatio: "16/9", borderRadius: 6 }} />}
                    <span className="mono small muted">{i + 1} · {s.custom ? `custom: ${s.custom}` : s.type}</span>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{s.title || s.type}</span>
                  </button>
                ))}
              </div>
              <SceneEditor key={`${selected}-${art.updated_at}`} artifact={art} index={selected} scene={spec.scenes[selected]} busy={busy}
                error={spec.scenes[selected]?.custom ? d.custom_errors?.[spec.scenes[selected].custom!] : undefined} onChanged={reload} rerun={rerun} />
            </div>
          )}
        </section>

        <section className="panel pipeline stack" aria-label="Pipeline" style={{ padding: 18 }}>
          <h2 className="display" style={{ fontWeight: 500, fontSize: 17 }}>Pipeline</h2>
          <ol className="steps">
            {STAGES.map(([key, label]) => {
              let state = stages[key] ?? (art.status === "done" ? "done" : "pending");
              if (art.status === "failed" && state === "running") state = "failed";
              const detail = state === "running" && art.progress.total
                ? key === "render" ? `${d.render_stage ?? ""} ${art.progress.done ?? 0}%` : `${art.progress.done} of ${art.progress.total}`
                : "";
              return (
                <li key={key} className={state === "running" ? "running" : ""}>
                  <span className={`step-dot ${state}`}>{state === "done" ? <Icon name="check" size={12} /> : state === "running" ? <span className="spinner" style={{ width: 10, height: 10 }} /> : null}</span>
                  <span className="stack" style={{ gap: 2, flex: 1 }}>
                    <span style={{ fontWeight: 600 }}>{label}</span>
                    {detail && <span className="small" style={{ color: "var(--accent-ink)" }}>{detail}</span>}
                    {state === "running" && art.progress.total ? (
                      <div className="progress"><div style={{ width: `${Math.round(((art.progress.done ?? 0) / art.progress.total) * 100)}%` }} /></div>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
          {art.status === "failed" && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="error-box" style={{ whiteSpace: "pre-wrap" }}>{art.error}</div>
              <button className="btn" onClick={() => rerun(spec ? "narration" : "script")}><Icon name="retry" size={16} /> Try again</button>
            </div>
          )}
          {d.checks && d.checks.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <h3 style={{ fontSize: 13 }}>Checks</h3>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }} className="stack">
                {d.checks.map((c) => (
                  <li key={c.name} className="row small" style={{ alignItems: "flex-start" }}>
                    <span className={`step-dot ${c.ok ? "done" : "failed"}`} style={{ width: 18, height: 18 }}>{c.ok ? <Icon name="check" size={10} /> : <Icon name="close" size={10} />}</span>
                    <span><strong>{c.name}</strong> <span className="muted">{c.detail}</span></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {d.flagged_lines && d.flagged_lines.length > 0 && (
            <div className="card stack" style={{ gap: 6, background: "var(--amber-soft)", borderColor: "transparent" }}>
              <strong className="small">Lines to listen to</strong>
              {d.flagged_lines.map((f, i) => (
                <button key={i} className="small" style={{ textAlign: "left", border: 0, background: "none", padding: 0 }} onClick={() => jump(f.scene)}>
                  Scene {f.scene + 1}: “{f.text}” was heard as “{f.heard}”
                </button>
              ))}
            </div>
          )}
          <p className="small muted" style={{ margin: 0 }}>Automatic checks can't judge how the voice sounds. Listen for names and technical terms.</p>
        </section>
      </main>
    </div>
  );
}

function ReportCard({ report }: { report: Report }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong className="small">Coverage report</strong>
        <button className="btn sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Hide" : "Show"}</button>
      </div>
      {report.words !== undefined && <span className="small muted">{report.words} words · about {report.minutes_estimate} min</span>}
      {open && (
        <>
          {report.covered?.length ? <div className="small"><strong>Covered</strong><ul style={{ margin: "4px 0", paddingLeft: 18 }}>{report.covered.map((c, i) => <li key={i}>{c.point}{c.scene !== undefined ? ` (scene ${c.scene})` : ""}</li>)}</ul></div> : null}
          {report.gaps?.length ? <div className="small"><strong>Not covered</strong><ul style={{ margin: "4px 0", paddingLeft: 18 }}>{report.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></div> : null}
          {report.own_wording?.length ? <div className="small"><strong>Not from the sources</strong><ul style={{ margin: "4px 0", paddingLeft: 18 }}>{report.own_wording.map((g, i) => <li key={i}>{g}</li>)}</ul></div> : null}
        </>
      )}
    </div>
  );
}

function SceneEditor({ artifact, index, scene, busy, error, onChanged, rerun }: {
  artifact: Artifact; index: number; scene?: Scene; busy: boolean; error?: string; onChanged: () => void; rerun: (start: string) => Promise<void>;
}) {
  const [lines, setLines] = useState(scene?.lines.join("\n") ?? "");
  const [instruction, setInstruction] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setLines(scene?.lines.join("\n") ?? ""), [scene]);
  if (!scene) return null;
  const changed = lines.trim() !== scene.lines.join("\n").trim();

  async function revoice() {
    setWorking("Saving lines");
    setErr(null);
    try {
      await api(`/artifacts/${artifact.id}/video/scenes/${index}`, { method: "PATCH", body: { lines: lines.split("\n") } });
      await rerun("narration");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setWorking(null);
    }
  }

  async function redraw() {
    setWorking("Redrawing the scene");
    setErr(null);
    try {
      await api(`/artifacts/${artifact.id}/video/scenes/${index}/redraw`, { body: { instruction } });
      await rerun("scenes");
      setInstruction("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setWorking(null);
    }
    onChanged();
  }

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <label className="field">
        <span className="kicker">Narration · scene {index + 1} (one line per row)</span>
        <textarea className="textarea" rows={Math.max(3, scene.lines.length + 1)} value={lines} onChange={(e) => setLines(e.target.value)} disabled={busy} />
      </label>
      <div className="row wrap">
        <button className="btn sm" disabled={busy || !changed || !!working} onClick={revoice}>Save and re-voice</button>
        <label className="row grow" style={{ minWidth: 220 }}>
          <span className="sr-only">How should the scene change?</span>
          <input className="input" style={{ minHeight: 34, fontSize: 13 }} placeholder="Redraw: e.g. show it as a flow diagram" value={instruction} onChange={(e) => setInstruction(e.target.value)} disabled={busy} />
          <button className="btn sm" disabled={busy || !!working} onClick={redraw}>Redraw scene</button>
        </label>
        {scene.code && <button className="btn sm" onClick={() => setShowCode((s) => !s)} aria-expanded={showCode}>{showCode ? "Hide" : "View"} scene code</button>}
      </div>
      {working && <div className="row small muted"><span className="spinner" /> {working}…</div>}
      {error && <div className="error-box small" style={{ whiteSpace: "pre-wrap" }}>This custom scene didn't compile, so a kit scene was used instead.{"\n"}{error}</div>}
      {err && <div className="error-box">{err}</div>}
      {showCode && scene.code && <pre className="quote mono" style={{ maxHeight: 360, overflow: "auto", fontSize: 12 }}>{scene.code}</pre>}
    </div>
  );
}
