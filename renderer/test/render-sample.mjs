// Renders a short sample with every kit scene, one valid custom scene and one broken one.
// Usage: DATA_DIR=/tmp/x BROWSER_EXECUTABLE=... node test/render-sample.mjs
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

process.env.DATA_DIR ??= path.resolve("test-data");
const { renderJob, staticCheck } = await import("../server.mjs");

const fps = 30;
const lines = (texts) => texts.map((text, i) => ({ text, start: i * 30, end: i * 30 + 25 }));
const scene = (type, props, texts, extra = {}) => ({ type, props, lines: lines(texts), durationInFrames: texts.length * 30 + 20, ...extra });

const spec = {
  title: "Kit sample", palette: "deep-space", accent: "#F2B33D", fps, width: 1920, height: 1080,
  scenes: [
    scene("Title", { kicker: "Episode 1", title: "How cells make energy", subtitle: "From glucose to ATP" }, ["a", "b"]),
    scene("Hook", { question: "Where does all that ATP come from?" }, ["a"]),
    scene("Definition", { term: "ATP synthase", definition: "A rotary enzyme that makes ATP from ADP and phosphate.", source: "Lecture 7" }, ["a", "b"]),
    scene("Quote", { quote: "Protons flow back through the turbine.", attribution: "Lecture 7" }, ["a"]),
    scene("Steps", { title: "Respiration", steps: [{ title: "Glycolysis", detail: "Cytoplasm" }, { title: "Krebs cycle" }, { title: "Electron transport" }] }, ["a", "b", "c", "d"]),
    scene("Comparison", { left: { title: "Aerobic", points: ["Uses oxygen", "Lots of ATP"] }, right: { title: "Anaerobic", points: ["No oxygen", "Little ATP"] } }, ["a", "b", "c", "d"]),
    scene("Flow", { title: "Electron transport", nodes: ["NADH", "Complex I", "Complex III", "Complex IV"], caption: "Each step pumps protons" }, ["a", "b", "c", "d"]),
    scene("Timeline", { title: "Discoveries", events: [{ date: "1937", label: "Krebs cycle" }, { date: "1961", label: "Chemiosmosis" }, { date: "1994", label: "Rotary structure" }] }, ["a", "b", "c"]),
    scene("Chart", { title: "Relative ATP yield", bars: [{ label: "Glycolysis", level: 1 }, { label: "Krebs", level: 1 }, { label: "Oxidative", level: 5, highlight: true }] }, ["a", "b", "c"]),
    scene("Panels", { title: "Key parts", panels: [{ title: "Matrix", text: "Krebs cycle" }, { title: "Inner membrane", text: "Electron chain" }] }, ["a", "b"]),
    scene("Cast", { title: "Who's who", people: [{ name: "Hans Krebs", role: "Citric acid cycle" }, { name: "Peter Mitchell", role: "Chemiosmotic theory" }] }, ["a", "b"]),
    scene("Orbit", { center: "Mitochondrion", items: ["Matrix", "Cristae", "DNA", "Ribosomes"] }, ["a", "b", "c", "d"]),
    scene("Spectrum", { title: "Membrane permeability", left: "Leaky", right: "Sealed", markers: [{ label: "Uncoupled", position: 0.15 }, { label: "Healthy", position: 0.85 }] }, ["a", "b"]),
    scene("Recap", { points: ["Food gives electrons", "Electrons pump protons", "Protons spin the turbine"] }, ["a", "b", "c"]),
    scene("Custom", {}, ["a", "b"], { custom: "Turbine", fallback: { type: "Panels", props: {} } }),
    scene("Custom", {}, ["a"], { custom: "Broken", fallback: { type: "Panels", props: { title: "Fallback" } } }),
  ],
};

const good = `import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Background, Heading, type SceneProps } from "../kit";

export default function Turbine({ accent, palette, lines }: SceneProps) {
  const frame = useCurrentFrame();
  return (
    <Background palette={palette} accent={accent}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40 }}>
        <svg width="400" height="400" viewBox="-100 -100 200 200" style={{ transform: \`rotate(\${frame * 6}deg)\` }}>
          {[0, 1, 2].map((i) => <rect key={i} x="-10" y="-90" width="20" height="90" rx="10" fill={accent} transform={\`rotate(\${i * 120})\`} />)}
        </svg>
        <Heading>{lines[0]?.text}</Heading>
      </AbsoluteFill>
    </Background>
  );
}
`;
const broken = `import React from "react";\nimport fs from "fs";\nexport default function Broken() { const x: number = "nope"; return <div>{x}</div>; }\n`;

assert.ok(staticCheck(broken).some((p) => p.includes('"fs"')));
assert.deepEqual(staticCheck(good), []);

const jobDir = path.join(process.env.DATA_DIR, "job-sample");
await fs.rm(jobDir, { recursive: true, force: true });
await fs.mkdir(path.join(jobDir, "custom"), { recursive: true });
await fs.writeFile(path.join(jobDir, "spec.json"), JSON.stringify(spec));
await fs.writeFile(path.join(jobDir, "custom/Turbine.tsx"), good);
await fs.writeFile(path.join(jobDir, "custom/Broken.tsx"), broken);

const job = { jobDir, status: "running", progress: 0, failed: {} };
const t0 = Date.now();
await renderJob(job);
console.log("render took", ((Date.now() - t0) / 1000).toFixed(1), "s");
assert.equal(job.status, "done");
assert.ok(job.failed.Broken, "broken custom scene should be reported");
assert.ok(!job.failed.Turbine, "valid custom scene should pass: " + job.failed.Turbine);
assert.equal(job.result.stills.length, spec.scenes.length);
const stat = await fs.stat(path.join(jobDir, "silent.mp4"));
assert.ok(stat.size > 10000);
console.log("OK", job.result, Object.keys(job.failed));
