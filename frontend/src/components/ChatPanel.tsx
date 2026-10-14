import { useEffect, useRef, useState } from "react";
import { api, streamEvents, type ChatConfig, type Citation, type Message, type Notebook } from "../lib/api";
import { startRecording } from "../lib/recorder";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";

type Pending = { question: string; text: string; citations: Citation[]; error?: string };

export function ChatPanel({ notebook, readyCount, onOpenSource, onNoteSaved, onNotebookChange, pendingQuestion, onQuestionTaken }: {
  notebook: Notebook;
  readyCount: number;
  onOpenSource: (sourceId: string, passage?: string) => void;
  onNoteSaved: () => void;
  onNotebookChange: (nb: Notebook) => void;
  /** A question sent from elsewhere (e.g. a mind map node) to ask now. */
  pendingQuestion?: string | null;
  onQuestionTaken?: () => void;
}) {
  const [configuring, setConfiguring] = useState(false);
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

  useEffect(() => {
    if (pendingQuestion && !pending) {
      onQuestionTaken?.();
      ask(pendingQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuestion]);

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
            <button className="btn sm" onClick={() => onOpenSource(openCite.c.source_id, openCite.c.text)}>Open source</button>
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
        <div className="row">
          <button className="btn sm" onClick={() => setConfiguring(true)}>Configure</button>
          {messages.length > 0 && <button className="btn sm" onClick={clear}>Clear</button>}
        </div>
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
      {configuring && (
        <ChatConfigDialog notebook={notebook} onClose={() => setConfiguring(false)}
          onSaved={(nb) => { onNotebookChange(nb); setConfiguring(false); }} />
      )}
    </section>
  );
}

function ChatConfigDialog({ notebook, onClose, onSaved }: { notebook: Notebook; onClose: () => void; onSaved: (nb: Notebook) => void }) {
  const [cfg, setCfg] = useState<ChatConfig>({ style: "default", length: "default", custom: "", ...notebook.chat_config });
  const [error, setError] = useState<string | null>(null);
  const styles: [NonNullable<ChatConfig["style"]>, string, string][] = [
    ["default", "Default", "Clear answers grounded in your sources."],
    ["guide", "Learning guide", "Explains step by step and checks your understanding."],
    ["analyst", "Analyst", "Concise, structured, points out gaps and disagreements."],
    ["custom", "Custom", "Your own instructions."],
  ];
  async function save() {
    try {
      onSaved(await api<Notebook>(`/notebooks/${notebook.id}`, { method: "PATCH", body: { chat_config: cfg } }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog title="Configure chat" onClose={onClose}>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <legend className="field" style={{ marginBottom: 8 }}>Conversational style</legend>
        {styles.map(([value, label, hint]) => (
          <label key={value} className="card row" style={{ alignItems: "flex-start", gap: 12, cursor: "pointer", borderColor: cfg.style === value ? "var(--accent)" : undefined }}>
            <input type="radio" name="chat-style" checked={cfg.style === value} onChange={() => setCfg({ ...cfg, style: value })}
              style={{ width: 18, height: 18, marginTop: 2, accentColor: "var(--accent)" }} />
            <span><strong>{label}</strong><br /><span className="small muted">{hint}</span></span>
          </label>
        ))}
      </fieldset>
      {cfg.style === "custom" && (
        <label className="field">How should the chat respond?
          <textarea className="textarea" rows={3} maxLength={2000} value={cfg.custom ?? ""} placeholder="e.g. Answer as a tutor for a first-year student, and suggest a related question each time."
            onChange={(e) => setCfg({ ...cfg, custom: e.target.value })} />
        </label>
      )}
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field" style={{ marginBottom: 6 }}>Response length</legend>
        <div className="tabs">
          {(["shorter", "default", "longer"] as const).map((l) => (
            <button key={l} type="button" className="tab" aria-pressed={cfg.length === l} onClick={() => setCfg({ ...cfg, length: l })}>
              {{ shorter: "Shorter", default: "Default", longer: "Longer" }[l]}
            </button>
          ))}
        </div>
      </fieldset>
      {error && <div className="error-box">{error}</div>}
      <button className="btn accent" onClick={save}>Save</button>
    </Dialog>
  );
}
