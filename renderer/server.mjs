// Video renderer service. The backend writes spec.json (+ custom/*.tsx) into a job folder on the
// shared /data volume and asks this service to type-check and render it. This container should run
// without network access: LLM-written scene code executes here.

import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { execFile, fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import express from "express";

const run = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "/data");
const WORK_DIR = path.resolve(process.env.WORK_DIR ?? path.join(ROOT, "work"));
const PORT = Number(process.env.PORT ?? 3100);
const CONCURRENCY = process.env.RENDER_CONCURRENCY ? Number(process.env.RENDER_CONCURRENCY) : null;
const BROWSER = process.env.BROWSER_EXECUTABLE || null;
const GL = process.env.REMOTION_GL || null;

const ALLOWED_IMPORTS = new Set(["react", "remotion", "../kit"]);
const FORBIDDEN = [
  [/\bfetch\s*\(/, "network access (fetch)"],
  [/XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon/, "network access"],
  [/\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(/, "dynamic code"],
  [/\brequire\s*\(|\bimport\s*\(/, "dynamic imports"],
  [/document\.cookie|localStorage|sessionStorage|indexedDB/, "browser storage"],
  [/window\.open|location\s*=|location\.href/, "navigation"],
  [/delayRender|continueRender/, "delayRender (it can stall the render)"],
  [/dangerouslySetInnerHTML/, "raw HTML"],
];
const NAME_RE = /^[A-Z][A-Za-z0-9]{0,40}$/;

/** Static rules for LLM-written scene code; the type checker runs after this. */
export function staticCheck(code) {
  const problems = [];
  for (const m of code.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/gm)) {
    if (!ALLOWED_IMPORTS.has(m[1])) problems.push(`import from "${m[1]}" is not allowed (use react, remotion or ../kit)`);
  }
  for (const [re, what] of FORBIDDEN) if (re.test(code)) problems.push(`${what} is not allowed`);
  if (!/export\s+default\s+/.test(code)) problems.push("the file must `export default` its scene component");
  return problems;
}

function insideData(dir) {
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(DATA_DIR + path.sep)) throw new Error("jobDir must be inside DATA_DIR");
  return resolved;
}

async function readCustom(jobDir) {
  const dir = path.join(jobDir, "custom");
  const out = {};
  let names = [];
  try {
    names = (await fs.readdir(dir)).filter((f) => f.endsWith(".tsx"));
  } catch {
    return out;
  }
  for (const file of names) {
    const name = file.slice(0, -4);
    if (NAME_RE.test(name)) out[name] = await fs.readFile(path.join(dir, file), "utf8");
  }
  return out;
}

/** Copy the project into a workspace with the job's custom scenes; returns errors per scene name. */
async function prepareWorkspace(jobDir, custom) {
  const ws = path.join(WORK_DIR, randomUUID());
  await fs.mkdir(ws, { recursive: true });
  await fs.cp(path.join(ROOT, "src"), path.join(ws, "src"), { recursive: true });
  // Workspaces may live outside the project (WORK_DIR), so link the dependencies in.
  await fs.symlink(path.join(ROOT, "node_modules"), path.join(ws, "node_modules"), "dir");
  await fs.writeFile(
    path.join(ws, "tsconfig.json"),
    JSON.stringify({ extends: path.join(ROOT, "tsconfig.json"), include: ["src"], compilerOptions: { typeRoots: [path.join(ROOT, "node_modules/@types")] } }),
  );
  const errors = {};
  for (const [name, code] of Object.entries(custom)) {
    const problems = staticCheck(code);
    if (problems.length) errors[name] = problems.join("; ");
  }
  const writeIndex = async (names) => {
    for (const name of names) await fs.writeFile(path.join(ws, "src/custom", `${name}.tsx`), custom[name]);
    const imports = names.map((n) => `import ${n} from "./${n}";`).join("\n");
    await fs.writeFile(
      path.join(ws, "src/custom/index.ts"),
      `import type React from "react";\nimport type { SceneProps } from "../kit/types";\n${imports}\n\nexport const CUSTOM: Record<string, React.FC<SceneProps>> = { ${names.join(", ")} };\n`,
    );
  };
  let candidates = Object.keys(custom).filter((n) => !errors[n]);
  await writeIndex(candidates);
  if (candidates.length) {
    const tsc = path.join(ROOT, "node_modules/typescript/bin/tsc");
    try {
      await run(process.execPath, [tsc, "--noEmit", "--pretty", "false", "-p", path.join(ws, "tsconfig.json")], { cwd: ws, maxBuffer: 8 << 20 });
    } catch (err) {
      const output = String(err.stdout ?? "") + String(err.stderr ?? "");
      for (const line of output.split("\n")) {
        const m = line.match(/src[\\/]custom[\\/]([A-Za-z0-9]+)\.tsx\((\d+),(\d+)\): error (TS\d+: .*)/);
        if (m) errors[m[1]] = ((errors[m[1]] ? errors[m[1]] + "\n" : "") + `line ${m[2]}: ${m[4]}`).slice(0, 2000);
      }
      if (!Object.keys(errors).length) errors.__kit = output.slice(0, 2000);
    }
    // Drop failing scenes from the bundle; they fall back to kit scenes.
    const failing = candidates.filter((n) => errors[n]);
    if (failing.length) {
      for (const n of failing) await fs.rm(path.join(ws, "src/custom", `${n}.tsx`), { force: true });
      candidates = candidates.filter((n) => !errors[n]);
      await writeIndex(candidates);
    }
  }
  return { ws, errors, ok: candidates };
}

const jobs = new Map();
let queue = Promise.resolve();

/**
 * Render in a child process: bundling and rendering keep the CPU busy, and doing that in this
 * process would freeze the HTTP API that the backend polls for progress.
 */
function renderInWorker(job) {
  return new Promise((resolve) => {
    const child = fork(fileURLToPath(import.meta.url), ["--worker"], { stdio: "inherit" });
    child.on("message", (update) => Object.assign(job, update));
    child.on("exit", (code) => {
      if (job.status !== "done" && job.status !== "failed") {
        job.status = "failed";
        job.error = job.error ?? `Renderer worker exited with code ${code}`;
      }
      resolve();
    });
    child.send({ jobDir: job.jobDir, mode: job.mode });
  });
}

async function renderJob(job) {
  const jobDir = job.jobDir;
  const spec = JSON.parse(await fs.readFile(path.join(jobDir, "spec.json"), "utf8"));
  job.stage = "checking";
  const custom = await readCustom(jobDir);
  const { ws, errors } = await prepareWorkspace(jobDir, custom);
  job.failed = errors;
  for (const scene of spec.scenes) {
    if (scene.type === "Custom" && (!scene.custom || errors[scene.custom] || !custom[scene.custom])) {
      scene.type = scene.fallback?.type ?? "Panels";
      scene.props = scene.fallback?.props ?? {};
    }
  }
  try {
    job.stage = "bundling";
    const serveUrl = await bundle({ entryPoint: path.join(ws, "src/index.ts"), onProgress: (p) => (job.progress = p / 1000) });
    const inputProps = { spec };
    const chromiumOptions = GL ? { gl: GL } : {};
    const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps, browserExecutable: BROWSER, chromiumOptions });
    job.stage = "rendering";
    const out = path.join(jobDir, "silent.mp4");
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: out,
      inputProps,
      muted: true,
      concurrency: CONCURRENCY,
      browserExecutable: BROWSER,
      chromiumOptions,
      onProgress: ({ progress }) => (job.progress = progress),
    });
    job.stage = "stills";
    await fs.mkdir(path.join(jobDir, "stills"), { recursive: true });
    const stills = [];
    let offset = 0;
    for (let i = 0; i < spec.scenes.length; i++) {
      const scene = spec.scenes[i];
      const lastLine = scene.lines[scene.lines.length - 1];
      const frame = offset + Math.min(scene.durationInFrames - 12, Math.max(0, lastLine ? lastLine.start + 20 : scene.durationInFrames / 2));
      const file = path.join(jobDir, "stills", `scene-${String(i + 1).padStart(2, "0")}.jpg`);
      await renderStill({ composition, serveUrl, output: file, frame: Math.round(frame), inputProps, imageFormat: "jpeg", jpegQuality: 70, scale: 0.25, browserExecutable: BROWSER, chromiumOptions });
      stills.push(path.relative(jobDir, file));
      offset += scene.durationInFrames;
    }
    await fs.writeFile(path.join(jobDir, "rendered-spec.json"), JSON.stringify(spec));
    job.result = { video: "silent.mp4", stills, durationInFrames: composition.durationInFrames, fps: composition.fps };
    job.status = "done";
    job.stage = "done";
  } finally {
    await fs.rm(ws, { recursive: true, force: true });
  }
}

/** Render still.json (an infographic) to still.png. No custom code is involved, so no workspace. */
async function renderStillJob(job) {
  const spec = JSON.parse(await fs.readFile(path.join(job.jobDir, "still.json"), "utf8"));
  job.stage = "bundling";
  const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src/index.ts") });
  const inputProps = { spec };
  const chromiumOptions = GL ? { gl: GL } : {};
  const composition = await selectComposition({ serveUrl, id: "Infographic", inputProps, browserExecutable: BROWSER, chromiumOptions });
  job.stage = "rendering";
  await renderStill({ composition, serveUrl, output: path.join(job.jobDir, "still.png"), frame: 0, inputProps, imageFormat: "png", browserExecutable: BROWSER, chromiumOptions });
  job.result = { image: "still.png", width: composition.width, height: composition.height };
  job.status = "done";
  job.stage = "done";
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/check", async (req, res) => {
  try {
    const jobDir = insideData(req.body.jobDir);
    const custom = await readCustom(jobDir);
    const { ws, errors, ok } = await prepareWorkspace(jobDir, custom);
    await fs.rm(ws, { recursive: true, force: true });
    res.json({ errors, ok });
  } catch (err) {
    res.status(400).json({ error: String(err.message ?? err) });
  }
});

app.post("/jobs", (req, res) => {
  let jobDir;
  try {
    jobDir = insideData(req.body.jobDir);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const id = randomUUID();
  const mode = req.body.mode === "still" ? "still" : "video";
  const job = { id, jobDir, mode, status: "queued", stage: "queued", progress: 0, failed: {}, result: null, error: null };
  jobs.set(id, job);
  queue = queue.then(async () => {
    job.status = "running";
    await renderInWorker(job);
  });
  res.json({ id });
});

app.get("/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "unknown job" });
  res.json(job);
});

if (process.argv.includes("--worker")) {
  // Child process: render one job and report progress to the parent.
  process.once("message", async ({ jobDir, mode }) => {
    const job = { jobDir, status: "running", stage: "checking", progress: 0, failed: {}, result: null, error: null };
    const report = () => process.send?.({ status: job.status, stage: job.stage, progress: job.progress, failed: job.failed, result: job.result, error: job.error });
    const timer = setInterval(report, 1000);
    try {
      await (mode === "still" ? renderStillJob(job) : renderJob(job));
    } catch (err) {
      job.status = "failed";
      job.error = String(err.stack ?? err).slice(0, 4000);
    }
    clearInterval(timer);
    report();
    // Exit explicitly: the browser pool can keep handles open.
    setTimeout(() => process.exit(job.status === "done" ? 0 : 1), 200);
  });
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await fs.mkdir(WORK_DIR, { recursive: true });
  if (!BROWSER) await ensureBrowser();
  app.listen(PORT, () => console.log(`renderer listening on :${PORT}`));
}

export { app, prepareWorkspace, renderJob, renderStillJob };
