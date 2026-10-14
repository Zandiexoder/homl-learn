import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChatPanel } from "../components/ChatPanel";
import { Header } from "../components/Header";
import { SourcesPanel } from "../components/SourcesPanel";
import { StudioPanel } from "../components/StudioPanel";
import { api, type Artifact, type Note, type Notebook, type SettingsResponse, type Source } from "../lib/api";
import { usePolled } from "../lib/hooks";

const busySources = (list: Source[]) => list.some((s) => s.status === "queued" || s.status === "processing");
const busyArtifacts = (list: Artifact[]) => list.some((a) => a.status === "queued" || a.status === "running");

export function NotebookPage() {
  const { id } = useParams<{ id: string }>();
  const [title, setTitle] = useState("");
  const [model, setModel] = useState<string>("");
  const [focusSource, setFocusSource] = useState<string | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const sources = usePolled<Source[]>(`/notebooks/${id}/sources`, busySources);
  const artifacts = usePolled<Artifact[]>(`/notebooks/${id}/artifacts`, busyArtifacts);
  const notes = usePolled<Note[]>(`/notebooks/${id}/notes`, () => false);
  // The summary, suggested questions and title update after sources are read.
  const nb = usePolled<Notebook>(`/notebooks/${id}`, (n) => !!n.overview_pending);
  const notebook = nb.data;
  const sourcesBusy = sources.data ? busySources(sources.data) : false;

  useEffect(() => {
    if (sourcesBusy) nb.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcesBusy]);

  useEffect(() => {
    if (notebook) setTitle(notebook.title);
  }, [notebook?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api<SettingsResponse>("/settings").then(({ settings }) => {
      const role = settings.roles.chat;
      const conn = settings.connections[role?.connection];
      setModel(conn ? `${role.model} · ${conn.name}` : "No model set up");
    });
  }, []);

  async function rename() {
    if (!notebook || title.trim() === notebook.title) return;
    nb.setData(await api<Notebook>(`/notebooks/${id}`, { method: "PATCH", body: { title } }));
  }

  if (!notebook) return null;
  const readyCount = (sources.data ?? []).filter((s) => s.status === "ready" && s.selected).length;

  return (
    <div className="app">
      <Header
        right={
          <Link className="chip" to="/settings" title="Change the model in Settings">
            <span className="dot" />
            <span>{model}</span>
          </Link>
        }
      >
        <span className="crumb" aria-hidden="true">/</span>
        <label className="grow" style={{ maxWidth: 520 }}>
          <span className="sr-only">Notebook title</span>
          <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={rename}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
        </label>
      </Header>
      <main className="workspace">
        <SourcesPanel notebookId={notebook.id} sources={sources.data ?? []} reload={() => { sources.reload(); nb.reload(); }} focusId={focusSource} />
        <ChatPanel key={notebook.id} notebook={notebook} readyCount={readyCount} onNoteSaved={notes.reload}
          onNotebookChange={nb.setData} pendingQuestion={question} onQuestionTaken={() => setQuestion(null)}
          onOpenSource={(sid) => { setFocusSource(null); requestAnimationFrame(() => setFocusSource(sid)); }} />
        <StudioPanel notebookId={notebook.id} artifacts={artifacts.data ?? []} notes={notes.data ?? []}
          reloadArtifacts={artifacts.reload} reloadNotes={notes.reload} onAsk={setQuestion} />
      </main>
    </div>
  );
}
