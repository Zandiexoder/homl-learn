import { useEffect, useRef, useState } from "react";
import { api, fileUrl, type Artifact } from "../lib/api";
import { startRecording } from "../lib/recorder";
import { ShareButton } from "./ArtifactViewer";
import { Icon } from "./Icon";

type Turn = { speaker: "A" | "B"; text: string; start?: number };
type Reply = { question: string; turns: Turn[]; audio: string };

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Audio Overview player with interactive mode: interrupt the hosts and ask a question. */
export function AudioPlayer({ artifact }: { artifact: Artifact }) {
  const data = artifact.data as { audio: string; duration: number; turns: Turn[]; provider?: string };
  const main = useRef<HTMLAudioElement>(null);
  const reply = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [mode, setMode] = useState<"idle" | "listening" | "thinking" | "answering">("idle");
  const [recorder, setRecorder] = useState<null | { stop: () => Promise<Blob>; cancel: () => void }>(null);
  const [typed, setTyped] = useState("");
  const [answer, setAnswer] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  const current = data.turns.reduce((idx, t, i) => ((t.start ?? 0) <= time ? i : idx), 0);

  useEffect(() => () => recorder?.cancel(), [recorder]);

  function toggle() {
    const el = main.current!;
    if (el.paused) el.play();
    else el.pause();
  }

  async function join() {
    setError(null);
    main.current?.pause();
    try {
      setRecorder(await startRecording());
      setMode("listening");
    } catch {
      setMode("listening"); // fall back to typing
    }
  }

  async function send(blob?: Blob) {
    setMode("thinking");
    const form = new FormData();
    form.append("position", String(main.current?.currentTime ?? 0));
    if (blob) form.append("audio", blob, "question.webm");
    else form.append("text", typed);
    try {
      const r = await api<Reply>(`/artifacts/${artifact.id}/interject`, { form });
      setAnswer(r);
      setTyped("");
      setMode("answering");
      requestAnimationFrame(() => reply.current?.play());
    } catch (e) {
      setError((e as Error).message);
      setMode("idle");
    }
  }

  async function stopListening() {
    if (recorder) {
      const blob = await recorder.stop();
      setRecorder(null);
      send(blob);
    } else if (typed.trim()) send();
  }

  function cancel() {
    recorder?.cancel();
    setRecorder(null);
    setMode("idle");
  }

  function resume() {
    setMode("idle");
    main.current?.play();
  }

  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="grow">
          <div style={{ fontWeight: 600 }}>{artifact.title}</div>
          <div className="mono small muted">Two hosts · {data.provider ?? "voice"} · {fmt(data.duration ?? 0)}</div>
        </div>
        <a className="icon-btn" href={fileUrl(data.audio)} download aria-label="Download audio"><Icon name="download" size={16} /></a>
      </div>
      <audio ref={main} src={fileUrl(data.audio)} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} />
      <div className="row" style={{ gap: 12 }}>
        <button onClick={toggle} aria-label={playing ? "Pause" : "Play"} disabled={mode !== "idle"}
          style={{ width: 44, height: 44, flex: "none", border: 0, borderRadius: "50%", background: "var(--ink)", color: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name={playing ? "pause" : "play"} size={16} />
        </button>
        <div className="grow stack" style={{ gap: 4 }}>
          <input type="range" min={0} max={data.duration || 1} step={0.1} value={time} aria-label="Seek"
            onChange={(e) => { if (main.current) main.current.currentTime = Number(e.target.value); }}
            style={{ width: "100%", accentColor: "var(--amber)" }} />
          <div className="row mono small muted" style={{ justifyContent: "space-between" }}><span>{fmt(time)}</span><span>{fmt(data.duration ?? 0)}</span></div>
        </div>
      </div>

      {mode === "idle" && (
        <button className="btn amber block" onClick={join}><Icon name="mic" size={16} /> Join the conversation</button>
      )}
      {mode === "listening" && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row small" style={{ color: "var(--amber-ink)" }}>
            {recorder ? <><span className="spinner" style={{ borderTopColor: "var(--amber)" }} /> Listening. Ask your question, then press Ask.</> : "Type your question for the hosts."}
          </div>
          {!recorder && <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Why does…" aria-label="Your question" />}
          <div className="row">
            <button className="btn amber grow" onClick={stopListening}>Ask</button>
            <button className="btn" onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}
      {mode === "thinking" && <div className="row small muted"><span className="spinner" /> The hosts are thinking about your question…</div>}
      {mode === "answering" && answer && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="small"><strong>You asked:</strong> {answer.question}</div>
          <audio ref={reply} src={fileUrl(answer.audio)} controls onEnded={resume} style={{ width: "100%" }} />
          <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={resume}>Back to the episode</button>
        </div>
      )}
      {error && <div className="error-box">{error}</div>}

      <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => setShowTranscript((v) => !v)} aria-expanded={showTranscript}>
        {showTranscript ? "Hide transcript" : "Show transcript"}
      </button>
      <ShareButton artifactId={artifact.id} />
      {showTranscript && (
        <ol className="stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: 6, maxHeight: 280, overflow: "auto" }}>
          {data.turns.map((t, i) => (
            <li key={i}>
              <button onClick={() => { if (main.current) { main.current.currentTime = t.start ?? 0; main.current.play(); } }}
                style={{ border: 0, textAlign: "left", width: "100%", padding: "6px 8px", borderRadius: 8, background: i === current ? "var(--amber-soft)" : "transparent", fontSize: 13 }}>
                <span className="mono small muted">Host {t.speaker} </span>{t.text}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
