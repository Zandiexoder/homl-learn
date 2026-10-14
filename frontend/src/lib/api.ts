export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 401) onUnauthorized();
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* not JSON */
    }
    throw new ApiError(detail || `Request failed (${res.status})`, res.status);
  }
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("application/json") ? res.json() : res.blob()) as Promise<T>;
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"), credentials: "same-origin" };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { "Content-Type": "application/json" };
  }
  return parse<T>(await fetch(`/api${path}`, init));
}

/** POST that streams server-sent events. */
export async function streamEvents(path: string, body: unknown, onEvent: (event: Record<string, unknown>) => void): Promise<void> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    await parse(res);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) onEvent(JSON.parse(line.slice(6)));
      }
    }
  }
}

export const fileUrl = (rel: string) => `/api/files/${rel.split("/").map(encodeURIComponent).join("/")}`;

// ---------------------------------------------------------------- types

export type ChatConfig = { style?: "default" | "guide" | "analyst" | "custom"; length?: "shorter" | "default" | "longer"; custom?: string };

export type Notebook = {
  id: string;
  title: string;
  summary: string | null;
  questions: string[];
  overview_pending: number;
  chat_config: ChatConfig;
  created_at: number;
  updated_at: number;
  source_count?: number;
  audio_count?: number;
  video_count?: number;
  studio_count?: number;
};

export type Source = {
  id: string;
  notebook_id: string;
  kind: "pdf" | "web" | "youtube" | "audio" | "text" | "file-text" | "docx";
  title: string;
  uri: string | null;
  status: "queued" | "processing" | "ready" | "failed";
  error: string | null;
  summary: string | null;
  selected: number;
  meta: Record<string, unknown>;
  text?: string;
};

export type Citation = { n: number; source_id: string; source_title: string; page: number | null; text: string; used?: boolean };

export type Message = { id: string; role: "user" | "assistant"; content: string; citations: Citation[]; created_at: number };

export type Note = { id: string; title: string; content: string; updated_at: number };

export type ArtifactStatus = "queued" | "running" | "done" | "failed";
export type Artifact = {
  id: string;
  notebook_id: string;
  kind: string;
  title: string;
  status: ArtifactStatus;
  progress: { stage?: string; done?: number; total?: number; stages?: Record<string, string> };
  options: Record<string, unknown>;
  data: Record<string, unknown>;
  error: string | null;
  created_at: number;
  updated_at: number;
};

export type Preset = {
  id: string;
  name: string;
  kind: string;
  location: string;
  base_url: string;
  model?: string;
  model_id?: string;
  needs_key?: boolean;
  context_tokens?: number;
  cloning?: boolean;
  projects?: boolean;
  stt?: boolean;
  note?: string;
};

export type Connection = {
  preset: string; name: string; kind: string; base_url: string; has_key?: boolean; api_key?: string; model?: string; context_tokens?: number;
};

export type Settings = {
  connections: Record<string, Connection>;
  roles: Record<string, { connection: string; model: string }>;
  embeddings: { preset: string; kind: string; base_url: string; model: string; has_key?: boolean; api_key?: string };
  voice: {
    preset: string; kind: string; base_url: string; model_id: string; project: string; host_a: string; host_b: string;
    narrator: string; language_code: string; has_key?: boolean; api_key?: string;
  };
  stt: { preset: string; kind: string; base_url: string; model: string; project: string; has_key?: boolean; api_key?: string };
  video: { palette: string; max_custom_scenes: number };
  search: { base_url: string };
  general: { language: string };
};

export type SettingsResponse = {
  settings: Settings;
  presets: { llm: Preset[]; voice: Preset[]; stt: Preset[]; embeddings: Preset[] };
};

export type Voice = { id: string; name: string; detail: string; status?: string };
