import { useState } from "react";
import { api, fileUrl, type Artifact } from "../lib/api";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";

type Card = { front: string; back: string; source?: string };
type Question = { question: string; options: string[]; answer: number; explanation?: string };
type MindNode = { label: string; children?: MindNode[] };
type Event = { date: string; title: string; detail?: string; source?: string };

/** Read-only content of a Studio output. Used by the owner's viewer and by public share pages. */
export function ArtifactContent({ kind, data: d, resolve, onAsk }: {
  kind: string;
  data: Record<string, unknown>;
  /** Turns a stored file path into a URL. */
  resolve: (path: string) => string;
  onAsk?: (question: string) => void;
}) {
  if (kind === "slides") return <SlideDeck deck={d as unknown as Deck} />;
  if (kind === "infographic") {
    return typeof d.image === "string"
      ? <img src={resolve(d.image)} alt={String(d.title ?? "Infographic")} style={{ width: "100%", maxWidth: 540, alignSelf: "center", borderRadius: 12, border: "1px solid var(--line)" }} />
      : <p className="muted">The image wasn't rendered.</p>;
  }
  if (kind === "audio" && typeof d.audio === "string") {
    const turns = (d.turns as { speaker: string; text: string }[]) ?? [];
    return (
      <div className="stack">
        <audio controls src={resolve(d.audio)} style={{ width: "100%" }} />
        <ol className="stack" style={{ listStyle: "none", margin: 0, padding: 0, gap: 8 }}>
          {turns.map((t, i) => <li key={i}><span className="mono small muted">Host {t.speaker} </span>{t.text}</li>)}
        </ol>
      </div>
    );
  }
  if (kind === "video" && typeof d.video === "string") {
    const stills = (d.stills as string[]) ?? [];
    return (
      <video className="player" controls src={resolve(d.video)} poster={stills[0] ? resolve(stills[0]) : undefined}>
        {typeof d.subtitles === "string" && <track kind="subtitles" label="Narration" srcLang="en" src={resolve(d.subtitles)} default />}
      </video>
    );
  }
  if (kind === "research" && typeof d.markdown === "string" && Array.isArray(d.references)) {
    // Turn [n] markers into links to the numbered web references.
    const refs = d.references as { n: number; url: string }[];
    const linked = d.markdown.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (whole, nums: string) => {
      const parts = nums.split(",").map((n) => refs.find((r) => r.n === Number(n.trim())));
      return parts.every(Boolean) ? parts.map((r) => `[[${r!.n}]](${r!.url})`).join("") : whole;
    });
    return <Markdown text={linked} />;
  }
  if (typeof d.markdown === "string") return <Markdown text={d.markdown} />;
  if (kind === "flashcards") return <Flashcards cards={d.cards as Card[]} />;
  if (kind === "quiz") return <Quiz questions={d.questions as Question[]} />;
  if (kind === "mindmap") {
    return (
      <>
        <p className="small muted" style={{ margin: 0 }}>Open a topic with + / −.{onAsk ? " Choose “Ask” to discuss it in the chat." : ""}</p>
        <ul className="mm-children" style={{ borderLeft: 0, margin: 0, paddingLeft: 0 }}>
          <MindMapNode node={d as unknown as MindNode} depth={0} path={[]} onAsk={onAsk} />
        </ul>
      </>
    );
  }
  if (kind === "timeline") return <TimelineView events={d.events as Event[]} cast={d.cast as { name: string; description: string }[]} />;
  return <pre className="quote">{JSON.stringify(d, null, 2)}</pre>;
}

export function ArtifactViewer({ artifact, onClose, onNoteSaved, onAsk, onSourcesAdded }: {
  artifact: Artifact; onClose: () => void; onNoteSaved: () => void; onAsk?: (question: string) => void; onSourcesAdded?: () => void;
}) {
  const d = artifact.data;
  const [saved, setSaved] = useState(false);

  async function toNote() {
    await api(`/artifacts/${artifact.id}/to-note`, { body: {} });
    setSaved(true);
    onNoteSaved();
  }

  return (
    <Dialog title={artifact.title} onClose={onClose} wide>
      {artifact.kind === "research" && Array.isArray(d.recommended) && (
        <ResearchSources notebookId={artifact.notebook_id} recommended={d.recommended as Recommended[]} onAdded={onSourcesAdded} />
      )}
      <ArtifactContent kind={artifact.kind} data={d} resolve={fileUrl} onAsk={onAsk && ((q) => { onAsk(q); onClose(); })} />
      <div className="row wrap">
        {typeof d.markdown === "string" && (
          <>
            <button className="btn" onClick={toNote} disabled={saved}><Icon name="note" size={16} /> {saved ? "Saved to notes" : "Save to notes"}</button>
            <button className="btn" onClick={() => navigator.clipboard.writeText(d.markdown as string)}><Icon name="copy" size={16} /> Copy</button>
          </>
        )}
        {artifact.kind === "slides" && (
          <a className="btn" href={`/api/artifacts/${artifact.id}/export/pptx`} download><Icon name="download" size={16} /> Download PowerPoint</a>
        )}
        {artifact.kind === "infographic" && typeof d.image === "string" && (
          <a className="btn" href={fileUrl(d.image)} download={`${artifact.title}.png`}><Icon name="download" size={16} /> Download PNG</a>
        )}
        <div className="spacer" />
        <ShareButton artifactId={artifact.id} />
      </div>
    </Dialog>
  );
}

type Recommended = { n: number; title: string; url: string; why: string };

function ResearchSources({ notebookId, recommended, onAdded }: { notebookId: string; recommended: Recommended[]; onAdded?: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(recommended.map((r) => r.url)));
  const [added, setAdded] = useState(false);
  if (!recommended.length) return null;
  async function add() {
    for (const url of picked) await api(`/notebooks/${notebookId}/sources/link`, { body: { url } });
    setAdded(true);
    onAdded?.();
  }
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <strong>Recommended sources</strong>
      {recommended.map((r) => (
        <label key={r.url} className="row" style={{ alignItems: "flex-start", gap: 10 }}>
          <input type="checkbox" style={{ width: 18, height: 18, marginTop: 2, accentColor: "var(--accent)" }} checked={picked.has(r.url)} disabled={added}
            onChange={() => setPicked((p) => { const n = new Set(p); n.has(r.url) ? n.delete(r.url) : n.add(r.url); return n; })} />
          <span className="grow">
            <a href={r.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>[{r.n}] {r.title}</a>
            {r.why && <span className="small muted" style={{ display: "block" }}>{r.why}</span>}
          </span>
        </label>
      ))}
      <button className="btn accent" style={{ alignSelf: "flex-start" }} onClick={add} disabled={added || !picked.size}>
        {added ? "Added to sources" : `Add ${picked.size} to sources`}
      </button>
    </div>
  );
}

export function ShareButton({ artifactId }: { artifactId: string }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const url = token ? `${window.location.origin}/share/${token}` : "";
  async function load() {
    setToken((await api<{ token: string | null }>(`/artifacts/${artifactId}/share`)).token);
  }
  async function create() {
    const t = (await api<{ token: string }>(`/artifacts/${artifactId}/share`, { body: {} })).token;
    setToken(t);
    await navigator.clipboard?.writeText(`${window.location.origin}/share/${t}`).then(() => setCopied(true), () => {});
  }
  async function revoke() {
    await api(`/artifacts/${artifactId}/share`, { method: "DELETE" });
    setToken(null);
    setCopied(false);
  }
  if (token === undefined) return <button className="btn" onClick={load}><Icon name="link" size={16} /> Share…</button>;
  if (!token) return <button className="btn" onClick={create}><Icon name="link" size={16} /> Create share link</button>;
  return (
    <span className="row wrap">
      <input className="input mono" readOnly value={url} aria-label="Share link" style={{ width: 280, minHeight: 36, fontSize: 12 }} onFocus={(e) => e.target.select()} />
      <button className="btn sm" onClick={() => navigator.clipboard.writeText(url).then(() => setCopied(true))}>{copied ? "Copied" : "Copy"}</button>
      <button className="btn sm danger" onClick={revoke}>Turn off link</button>
    </span>
  );
}

type Slide = {
  layout: "section" | "bullets" | "two_column" | "quote";
  title?: string; bullets?: string[]; notes?: string; quote?: string; attribution?: string;
  left?: { heading?: string; bullets?: string[] }; right?: { heading?: string; bullets?: string[] };
};
type Deck = { title: string; subtitle?: string; slides: Slide[] };

function SlideDeck({ deck }: { deck: Deck }) {
  const slides: Slide[] = [{ layout: "section", title: deck.title, bullets: deck.subtitle ? [deck.subtitle] : [] }, ...deck.slides];
  const [i, setI] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const s = slides[i];
  const go = (n: number) => setI(Math.max(0, Math.min(slides.length - 1, n)));
  const list = (items?: string[]) => <ul style={{ margin: 0, paddingLeft: "1.2em", display: "flex", flexDirection: "column", gap: "0.5em" }}>{items?.map((b, k) => <li key={k}>{b}</li>)}</ul>;
  return (
    <div className="stack" onKeyDown={(e) => { if (e.key === "ArrowRight") go(i + 1); if (e.key === "ArrowLeft") go(i - 1); }}>
      <div className="slide" data-layout={s.layout} role="group" aria-roledescription="slide" aria-label={`Slide ${i + 1} of ${slides.length}`} tabIndex={0}>
        {s.layout === "section" && (
          <div className="slide-center">
            <div className="slide-title">{s.title}</div>
            {s.bullets?.[0] && <div className="slide-sub">{s.bullets[0]}</div>}
          </div>
        )}
        {s.layout === "quote" && (
          <div className="slide-center">
            <div className="slide-quote">“{s.quote}”</div>
            {s.attribution && <div className="slide-sub">— {s.attribution}</div>}
          </div>
        )}
        {s.layout === "bullets" && (
          <>
            <div className="slide-title">{s.title}</div>
            <div className="slide-bar" />
            <div className="slide-body">{list(s.bullets)}</div>
          </>
        )}
        {s.layout === "two_column" && (
          <>
            <div className="slide-title">{s.title}</div>
            <div className="slide-bar" />
            <div className="slide-cols">
              {[s.left, s.right].map((col, k) => (
                <div key={k}><div className="slide-colhead">{col?.heading}</div><div className="slide-body">{list(col?.bullets)}</div></div>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button className="btn" onClick={() => go(i - 1)} disabled={i === 0}>Previous</button>
        <span className="mono small muted">{i + 1} / {slides.length}</span>
        <button className="btn primary" onClick={() => go(i + 1)} disabled={i === slides.length - 1}>Next</button>
      </div>
      {s.notes && (
        <div>
          <button className="btn sm" onClick={() => setShowNotes((v) => !v)} aria-expanded={showNotes}>{showNotes ? "Hide" : "Show"} speaker notes</button>
          {showNotes && <p className="card small" style={{ marginTop: 8 }}>{s.notes}</p>}
        </div>
      )}
    </div>
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

function MindMapNode({ node, depth, path, onAsk }: { node: MindNode; depth: number; path: string[]; onAsk?: (q: string) => void }) {
  const [open, setOpen] = useState(depth < 2);
  const kids = node.children ?? [];
  const trail = [...path, node.label];
  const question = depth === 0
    ? `Give me an overview of ${node.label} based on the sources.`
    : `Discuss what the sources say about ${node.label}, in the context of ${trail.slice(0, -1).join(" › ")}.`;
  return (
    <li>
      <span className="row" style={{ gap: 4 }}>
        <button className="mm-node" onClick={() => setOpen((o) => !o)} aria-expanded={kids.length ? open : undefined}
          style={depth === 0 ? { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)", fontWeight: 600 } : undefined}>
          {kids.length > 0 && <span className="mono small">{open ? "−" : "+"}</span>}
          {node.label}
        </button>
        {onAsk && <button className="btn sm ghost" onClick={() => onAsk(question)} aria-label={`Ask about ${node.label}`}>Ask</button>}
      </span>
      {open && kids.length > 0 && (
        <ul className="mm-children">
          {kids.map((c, i) => <MindMapNode key={i} node={c} depth={depth + 1} path={trail} onAsk={onAsk} />)}
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
