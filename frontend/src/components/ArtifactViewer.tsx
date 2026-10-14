import { useState } from "react";
import { api, type Artifact } from "../lib/api";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";

type Card = { front: string; back: string; source?: string };
type Question = { question: string; options: string[]; answer: number; explanation?: string };
type MindNode = { label: string; children?: MindNode[] };
type Event = { date: string; title: string; detail?: string; source?: string };

export function ArtifactViewer({ artifact, onClose, onNoteSaved }: { artifact: Artifact; onClose: () => void; onNoteSaved: () => void }) {
  const d = artifact.data;
  const [saved, setSaved] = useState(false);

  async function toNote() {
    await api(`/artifacts/${artifact.id}/to-note`, { body: {} });
    setSaved(true);
    onNoteSaved();
  }

  let body: React.ReactNode;
  if (typeof d.markdown === "string") {
    body = (
      <>
        <Markdown text={d.markdown} />
        <div className="row">
          <button className="btn" onClick={toNote} disabled={saved}><Icon name="note" size={16} /> {saved ? "Saved to notes" : "Save to notes"}</button>
          <button className="btn" onClick={() => navigator.clipboard.writeText(d.markdown as string)}><Icon name="copy" size={16} /> Copy</button>
        </div>
      </>
    );
  } else if (artifact.kind === "flashcards") body = <Flashcards cards={d.cards as Card[]} />;
  else if (artifact.kind === "quiz") body = <Quiz questions={d.questions as Question[]} />;
  else if (artifact.kind === "mindmap") body = <ul className="mm-children" style={{ borderLeft: 0, margin: 0, paddingLeft: 0 }}><MindMapNode node={d as unknown as MindNode} depth={0} /></ul>;
  else if (artifact.kind === "timeline") body = <TimelineView events={d.events as Event[]} cast={d.cast as { name: string; description: string }[]} />;
  else body = <pre className="quote">{JSON.stringify(d, null, 2)}</pre>;

  return (
    <Dialog title={artifact.title} onClose={onClose} wide>
      {body}
    </Dialog>
  );
}

function Flashcards({ cards }: { cards: Card[] }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const go = (n: number) => { setFlipped(false); setI((n + cards.length) % cards.length); };
  const card = cards[i];
  return (
    <div className="stack">
      <button className={`flashcard${flipped ? " flipped" : ""}`} onClick={() => setFlipped((f) => !f)} aria-label={flipped ? "Show question" : "Show answer"}>
        <div className="flashcard-inner">
          <div className="flashcard-face">{card.front}</div>
          <div className="flashcard-face back">{card.back}</div>
        </div>
      </button>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button className="btn" onClick={() => go(i - 1)}>Previous</button>
        <span className="mono small muted">{i + 1} / {cards.length}{card.source ? ` · ${card.source}` : ""}</span>
        <button className="btn primary" onClick={() => go(i + 1)}>Next</button>
      </div>
    </div>
  );
}

function Quiz({ questions }: { questions: Question[] }) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const score = Object.entries(answers).filter(([q, a]) => questions[Number(q)].answer === a).length;
  return (
    <div className="stack" style={{ gap: 20 }}>
      {questions.map((q, qi) => {
        const picked = answers[qi];
        return (
          <fieldset key={qi} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
            <legend style={{ fontWeight: 600, marginBottom: 8 }}>{qi + 1}. {q.question}</legend>
            {q.options.map((opt, oi) => {
              const state = picked === undefined ? "" : oi === q.answer ? " right" : oi === picked ? " wrong" : "";
              return (
                <button key={oi} className={`quiz-option${state}`} disabled={picked !== undefined} onClick={() => setAnswers((a) => ({ ...a, [qi]: oi }))}>
                  <span className="mono muted">{String.fromCharCode(65 + oi)}</span> {opt}
                </button>
              );
            })}
            {picked !== undefined && q.explanation && <p className="small muted" style={{ margin: 0 }}>{q.explanation}</p>}
          </fieldset>
        );
      })}
      <div className="card" aria-live="polite">Score: {score} / {Object.keys(answers).length} answered ({questions.length} questions)</div>
    </div>
  );
}

function MindMapNode({ node, depth }: { node: MindNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const kids = node.children ?? [];
  return (
    <li>
      <button className="mm-node" onClick={() => setOpen((o) => !o)} aria-expanded={kids.length ? open : undefined}
        style={depth === 0 ? { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)", fontWeight: 600 } : undefined}>
        {kids.length > 0 && <span className="mono small">{open ? "−" : "+"}</span>}
        {node.label}
      </button>
      {open && kids.length > 0 && (
        <ul className="mm-children">
          {kids.map((c, i) => <MindMapNode key={i} node={c} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}

function TimelineView({ events, cast }: { events: Event[]; cast: { name: string; description: string }[] }) {
  return (
    <div className="stack" style={{ gap: 24 }}>
      {events.length === 0 && <p className="muted">The sources have no dated events.</p>}
      <ol className="timeline">
        {events.map((e, i) => (
          <li key={i}>
            <div className="mono small" style={{ color: "var(--accent-ink)" }}>{e.date}</div>
            <div style={{ fontWeight: 600 }}>{e.title}</div>
            {e.detail && <div className="small">{e.detail}</div>}
            {e.source && <div className="small muted">{e.source}</div>}
          </li>
        ))}
      </ol>
      {cast?.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <h3 style={{ fontSize: 15 }}>Cast of characters</h3>
          {cast.map((c, i) => <div key={i} className="card"><strong>{c.name}</strong> — {c.description}</div>)}
        </div>
      )}
    </div>
  );
}
