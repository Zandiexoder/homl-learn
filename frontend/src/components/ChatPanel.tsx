import { useEffect, useRef, useState } from "react";
import { api, streamEvents, type Citation, type Message, type Notebook } from "../lib/api";
import { startRecording } from "../lib/recorder";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";

type Pending = { question: string; text: string; citations: Citation[]; error?: string };

export function ChatPanel({ notebook, readyCount, onOpenSource, onNoteSaved }: {
  notebook: Notebook;
  readyCount: number;
  onOpenSource: (sourceId: string) => void;
  onNoteSaved: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [input, setInput] = useState("");
  const [openCite, setOpenCite] = useState<{ msg: string; c: Citation } | null>(null);
  const [recording, setRecording] = useState<null | { stop: () => Promise<Blob> }>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Message[]>(`/notebooks/${notebook.id}/messages`).then(setMessages);
  }, [notebook.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, pending?.text]);

  async function ask(question: string) {
    question = question.trim();
    if (!question || pending) return;
    setInput("");
    const state: Pending = { question, text: "", citations: [] };
    setPending({ ...state });
    try {
      await streamEvents(`/notebooks/${notebook.id}/chat`, { message: question }, (ev) => {
        if (ev.type === "citations") state.citations = ev.citations as Citation[];
        if (ev.type === "delta") state.text += ev.text as string;
        if (ev.type === "error") state.error = ev.message as string;
        if (ev.type === "done") {
          const msg = ev.message as Message;
          setMessages((m) => [...m, { id: `${msg.id}-q`, role: "user", content: question, citations: [], created_at: msg.created_at }, msg]);
          setPending(null);
          return;
        }
        setPending({ ...state });
      });
    } catch (e) {
      setPending({ ...state, error: (e as Error).message });
    }
  }

  async function toggleVoice() {
    setVoiceError(null);
    if (recording) {
      const blob = await recording.stop();
      setRecording(null);
      const form = new FormData();
      form.append("audio", blob, "question.webm");
      try {
        const { text } = await api<{ text: string }>("/transcribe", { form });
        setInput((v) => (v ? v + " " : "") + text);
      } catch (e) {
        setVoiceError((e as Error).message);
      }
      return;
    }
    try {
      setRecording(await startRecording());
    } catch {
      setVoiceError("Microphone access was blocked.");
    }
  }

  async function saveNote(m: Message) {
    const prev = messages[messages.indexOf(m) - 1];
    await api(`/notebooks/${notebook.id}/notes`, { body: { title: prev?.content.slice(0, 80) ?? "Saved answer", content: m.content } });
    onNoteSaved();
  }

  async function clear() {
    if (!confirm("Clear this chat?")) return;
    await api(`/notebooks/${notebook.id}/messages`, { method: "DELETE" });
    setMessages([]);
  }

  const renderAnswer = (id: string, content: string, citations: Citation[]) => (
    <>
      <Markdown text={content} citations={citations} onCite={(c) => setOpenCite(openCite?.c === c ? null : { msg: id, c })} />
      {openCite?.msg === id && (
        <blockquote className="quote">
          <div className="row mono small muted" style={{ marginBottom: 4 }}>
            <span className="grow">[{openCite.c.n}] {openCite.c.source_title}{openCite.c.page ? ` · p. ${openCite.c.page}` : ""}</span>
            <button className="btn sm" onClick={() => onOpenSource(openCite.c.source_id)}>Open source</button>
          </div>
          {openCite.c.text}
        </blockquote>
      )}
    </>
  );

  return (
    <section className="panel pane-chat" aria-label="Chat">
      <div className="panel-head" style={{ padding: "14px 20px 8px" }}>
        <h2>Chat</h2>
        {messages.length > 0 && <button className="btn sm" onClick={clear}>Clear</button>}
      </div>
      <div className="chat-scroll" ref={scrollRef}>
        <div className="chat-col">
          {(notebook.summary || readyCount > 0) && (
            <div className="card" style={{ padding: 20 }}>
              <div className="kicker">Notebook summary</div>
              <p style={{ margin: "8px 0 0", fontSize: 15, lineHeight: 1.6 }}>
                {notebook.summary ?? "Reading your sources…"}
              </p>
              {notebook.questions.length > 0 && (
                <div className="row wrap" style={{ marginTop: 14 }}>
                  {notebook.questions.map((q) => (
                    <button key={q} className="chip" onClick={() => ask(q)}>{q}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {readyCount === 0 && !notebook.summary && (
            <p className="muted" style={{ textAlign: "center", marginTop: 40 }}>Add a source to start asking questions.</p>
          )}
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="bubble-user">{m.content}</div>
            ) : (
              <div key={m.id} className="stack" style={{ gap: 10 }}>
                {renderAnswer(m.id, m.content, m.citations)}
                <div className="row">
                  <button className="btn sm" onClick={() => saveNote(m)}><Icon name="note" size={14} /> Save to note</button>
                  <button className="btn sm" onClick={() => navigator.clipboard.writeText(m.content)}><Icon name="copy" size={14} /> Copy</button>
                </div>
              </div>
            ),
          )}
          {pending && (
            <>
              <div className="bubble-user">{pending.question}</div>
              <div className="stack" style={{ gap: 10 }} aria-live="polite">
                {pending.text ? renderAnswer("pending", pending.text, pending.citations) : !pending.error && <div className="row muted"><span className="spinner" /> Reading {pending.citations.length || ""} passages…</div>}
                {pending.error && <div className="error-box">{pending.error}</div>}
                {pending.error && <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => setPending(null)}>Dismiss</button>}
              </div>
            </>
          )}
        </div>
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        {voiceError && <div className="error-box" style={{ maxWidth: 760, margin: "0 auto 8px" }}>{voiceError}</div>}
        <label className="composer-box">
          <span className="sr-only">Ask about your sources</span>
          <textarea rows={2} placeholder={recording ? "Listening… press the mic again to stop" : `Ask about ${readyCount} source${readyCount === 1 ? "" : "s"}…`}
            value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }} />
          <button type="button" className="icon-btn" style={{ width: 44, height: 44, border: "1px solid var(--line)", background: recording ? "var(--danger-soft)" : undefined }}
            aria-label={recording ? "Stop recording" : "Ask by voice"} aria-pressed={!!recording} onClick={toggleVoice}>
            <Icon name="mic" />
          </button>
          <button type="submit" className="send" aria-label="Send" disabled={!input.trim() || !!pending}>
            <Icon name="send" />
          </button>
        </label>
      </form>
    </section>
  );
}
