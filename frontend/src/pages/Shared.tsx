import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ArtifactContent } from "../components/ArtifactViewer";
import { Logo } from "../components/Icon";

type SharedOutput = { kind: string; title: string; notebook: string; data: Record<string, unknown> };

const KIND_LABEL: Record<string, string> = {
  audio: "Audio Overview", video: "Video Overview", slides: "Slide deck", infographic: "Infographic", research: "Research report",
  study_guide: "Study guide", briefing: "Briefing doc", faq: "FAQ", report: "Report", mindmap: "Mind map",
  flashcards: "Flashcards", quiz: "Quiz", timeline: "Timeline",
};

/** Public, read-only page for one shared output. No sign-in. */
export function SharedPage() {
  const { token } = useParams<{ token: string }>();
  const [output, setOutput] = useState<SharedOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/public/${token}`).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? "This link isn't available.");
      setOutput(await r.json());
    }).catch((e) => setError(e.message));
  }, [token]);
  useEffect(() => {
    if (output) document.title = `${output.title} · Homl Learn`;
  }, [output]);
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand"><Logo /><span>homl learn</span></span>
      </header>
      <main className="home" style={{ maxWidth: 900, gap: 20 }}>
        {error && <div className="error-box" role="alert">{error}</div>}
        {!output && !error && <div className="row muted"><span className="spinner" /> Loading…</div>}
        {output && (
          <>
            <div>
              <div className="kicker">{KIND_LABEL[output.kind] ?? output.kind} · from “{output.notebook}”</div>
              <h1 style={{ fontSize: 36, marginTop: 6 }}>{output.title}</h1>
            </div>
            <div className="panel stack" style={{ padding: 20 }}>
              <ArtifactContent kind={output.kind} data={output.data} resolve={(p) => p} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
