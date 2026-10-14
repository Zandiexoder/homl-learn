// Renders a sample infographic. Usage: DATA_DIR=/tmp/x node test/render-infographic.mjs
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

process.env.DATA_DIR ??= path.resolve("test-data");
const { renderStillJob } = await import("../server.mjs");
if (!process.env.BROWSER_EXECUTABLE) await (await import("@remotion/renderer")).ensureBrowser();

const jobDir = path.join(process.env.DATA_DIR, "still-sample");
await fs.mkdir(jobDir, { recursive: true });
await fs.writeFile(path.join(jobDir, "still.json"), JSON.stringify({
  kind: "infographic", palette: "paper", accent: "#2F6F9F",
  data: {
    title: "How cells make energy",
    subtitle: "From glucose to ATP in three linked stages",
    stats: [{ value: "~30", label: "ATP per glucose molecule" }, { value: "3", label: "stages of respiration" }],
    sections: [
      { heading: "Glycolysis", text: "Glucose splits into pyruvate in the cytoplasm, giving a little ATP." },
      { heading: "Krebs cycle", text: "In the matrix, carbon is stripped off and electrons are loaded onto carriers." },
      { heading: "Electron transport", text: "Electrons power pumps that push protons out across the inner membrane." },
      { heading: "ATP synthase", text: "Protons flow back through the turbine, which spins to make ATP." },
    ],
    steps: ["Food gives electrons", "Electrons pump protons", "Protons spin the turbine"],
    takeaway: "A proton gradient across the inner membrane powers almost all of the cell's ATP.",
    source: "Lecture 7",
  },
}));
const job = { jobDir, status: "running", failed: {} };
await renderStillJob(job);
assert.equal(job.status, "done");
assert.equal(job.result.width, 1080);
const stat = await fs.stat(path.join(jobDir, "still.png"));
assert.ok(stat.size > 20000);
console.log("OK", path.join(jobDir, "still.png"));
