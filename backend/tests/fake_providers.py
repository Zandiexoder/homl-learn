"""Fake LLM (OpenAI-compatible) and fake voice server (10labs/ElevenLabs-compatible) for end-to-end runs.

    uvicorn tests.fake_providers:app --port 9100

Then in Settings use LLM base URL http://localhost:9100/v1 (Custom preset) and voice server
http://localhost:9100 (10labs preset). Replies are canned, keyed on words in the prompt. TTS returns a tone
whose length follows the text, so timing and mixing behave like real speech.
"""

from __future__ import annotations

import json
import subprocess
import tempfile

from fastapi import FastAPI, Request, Response
from fastapi.responses import StreamingResponse

app = FastAPI()

TURBINE = """import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Background, Heading, lineStart, springAt, useSceneFade, type SceneProps } from "../kit";

export default function Turbine({ lines, accent, palette, durationInFrames }: SceneProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = springAt(frame, fps, lineStart(lines, 1));
  return (
    <Background palette={palette} accent={accent} opacity={useSceneFade(durationInFrames)}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40 }}>
        <svg width="420" height="420" viewBox="-110 -110 220 220" style={{ transform: `rotate(${frame * 4 * p}deg)` }}>
          <circle r="22" fill={palette.text} />
          {[0, 1, 2].map((i) => (
            <rect key={i} x="-12" y="-100" width="24" height="90" rx="12" fill={accent} transform={`rotate(${i * 120})`} />
          ))}
        </svg>
        <Heading size={64}>The turbine spins</Heading>
      </AbsoluteFill>
    </Background>
  );
}
"""

VIDEO_SPEC = {
    "title": "How ATP synthase spins",
    "accent": "#5EE3C1",
    "scenes": [
        {"type": "Hook", "title": "Hook", "props": {"question": "Where does your energy actually come from?"},
         "lines": ["Every day your body makes roughly its own weight in ATP.", "So where does it all come from?"]},
        {"type": "Definition", "title": "ATP synthase", "props": {"term": "ATP synthase", "definition": "A rotary enzyme in the inner mitochondrial membrane that makes ATP.", "source": "Lecture 7"},
         "lines": ["Meet ATP synthase.", "It is a rotary enzyme sitting in the inner membrane of the mitochondrion."]},
        {"type": "Flow", "title": "Proton gradient", "props": {"title": "Building the gradient", "nodes": ["Electrons", "Pumps", "Protons outside", "Gradient"]},
         "lines": ["Electrons pass down the transport chain.", "Each hand-off powers a pump.", "Protons pile up outside the matrix.", "That builds a steep gradient."]},
        {"type": "Custom", "name": "Turbine", "title": "The turbine", "code": TURBINE, "fallback": {"type": "Panels", "props": {"title": "The turbine"}},
         "lines": ["The only way back in is through ATP synthase.", "The rushing protons spin it like a water wheel."]},
        {"type": "Recap", "title": "Recap", "props": {"points": ["Electrons power pumps", "Pumps build a gradient", "Protons spin the turbine"]},
         "lines": ["So, to recap.", "Electrons power the pumps.", "The pumps build a gradient.", "And the gradient spins the turbine that makes ATP."]},
    ],
    "report": {"covered": [{"point": "Proton gradient", "scene": 3}, {"point": "ATP synthase as rotary enzyme", "scene": 2}],
               "gaps": ["Glycolysis is not covered"], "own_wording": ["The water wheel comparison"]},
}


def reply_for(system: str, prompt: str) -> str:
    if "Explainer video: script and scenes" in system and "Redesign the visuals" in prompt:
        return json.dumps({"type": "Orbit", "title": "The turbine", "props": {"center": "ATP synthase", "items": ["Rotor", "Stator", "Protons"]}})
    if "Explainer video: script and scenes" in system:
        return json.dumps(VIDEO_SPEC)
    if "Fix it and reply with the complete corrected" in prompt:
        return "```tsx\n" + TURBINE + "\n```"
    if '"layout": "section"' in prompt:
        return json.dumps({"title": "How Cells Make Energy", "subtitle": "From glucose to ATP", "slides": [
            {"layout": "section", "title": "The big picture"},
            {"layout": "bullets", "title": "Three stages", "bullets": ["Glycolysis in the cytoplasm", "Krebs cycle in the matrix", "Electron transport on the inner membrane"], "notes": "Walk through each stage briefly."},
            {"layout": "two_column", "title": "Aerobic vs anaerobic", "left": {"heading": "Aerobic", "bullets": ["Uses oxygen", "About 30 ATP"]}, "right": {"heading": "Anaerobic", "bullets": ["No oxygen", "2 ATP"]}},
            {"layout": "quote", "quote": "Protons flow back through ATP synthase, spinning its rotor.", "attribution": "Lecture 7"},
            {"layout": "bullets", "title": "Summary", "bullets": ["Electrons power pumps", "Gradient spins the turbine"]}]})
    if '"takeaway"' in prompt:
        return json.dumps({"title": "How cells make energy", "subtitle": "A proton gradient powers ATP synthase",
                           "stats": [], "sections": [{"heading": "Electron transport", "text": "Electrons power pumps that move protons out of the matrix."},
                                                     {"heading": "ATP synthase", "text": "Protons flow back through a rotary enzyme that makes ATP."},
                                                     {"heading": "The membrane", "text": "The inner membrane must stay sealed to hold the gradient."}],
                           "steps": ["Electrons pump protons", "Protons spin the turbine", "The turbine makes ATP"],
                           "takeaway": "Cells store energy as a proton gradient, then cash it in as ATP.", "source": "Lecture 7"})
    if "Plan " in prompt and '"queries"' in prompt:
        return json.dumps({"queries": ["ATP synthase rotary mechanism", "chemiosmotic theory evidence"]})
    if "Research question:" in prompt:
        return json.dumps({"report": "## Findings\n\nATP synthase is a rotary motor driven by proton flow [1]. "
                                     "Mitchell's chemiosmotic theory is well supported [2].",
                           "recommended": [{"n": 1, "why": "Clear explainer of the mechanism"}, {"n": 2, "why": "History and evidence"}]})
    if "Reply with the single word: ready" in prompt:
        return "ready"
    if "Summarise this source" in prompt:
        return "Explains how mitochondria make ATP using a proton gradient.\nTopics: ATP synthase, proton gradient, electron transport"
    if "a short notebook title" in prompt:
        return json.dumps({"title": "Cell Energy", "summary": "These sources explain how cells turn food into ATP: electrons drive proton pumps, and the resulting gradient spins ATP synthase.",
                           "questions": ["What spins ATP synthase?", "Why must the inner membrane be sealed?", "How many protons make one ATP?"]})
    if "Source excerpts:" in prompt:
        return ("The electron transport chain pumps protons out of the matrix, building a gradient [1]. "
                "Protons flow back through **ATP synthase**, spinning its rotor so it joins ADP and phosphate into ATP [1, 2].")
    if "called in with a question" in prompt:
        return json.dumps({"turns": [{"speaker": "B", "text": "Oh, we have a question from a listener!"},
                                     {"speaker": "A", "text": "The protons flow back because the gradient pushes them, and the only door is the turbine. Anyway, back to where we were."}]})
    if "two-host audio conversation" in prompt:
        return json.dumps({"title": "The cell's power plant", "turns": [
            {"speaker": "A", "text": "Today we're looking at how your cells actually make energy."},
            {"speaker": "B", "text": "Wait, so there's a tiny turbine in every cell?"},
            {"speaker": "A", "text": "Pretty much. It's called ATP synthase, and protons spin it."},
            {"speaker": "B", "text": "That's wild. Where do the protons come from?"},
            {"speaker": "A", "text": "The electron transport chain pumps them out, building a gradient."}]})
    if '"cards"' in prompt:
        return json.dumps({"cards": [{"front": "What is ATP synthase?", "back": "A rotary enzyme that makes ATP", "source": "Lecture 7"},
                                     {"front": "What builds the proton gradient?", "back": "The electron transport chain", "source": "Lecture 7"}]})
    if '"questions"' in prompt:
        return json.dumps({"questions": [{"question": "Where is ATP synthase found?", "options": ["Nucleus", "Inner mitochondrial membrane", "Cytoplasm", "Ribosome"], "answer": 1, "explanation": "Lecture 7 places it in the inner membrane."}]})
    if '"label": "central topic"' in prompt:
        return json.dumps({"label": "Cell energy", "children": [{"label": "Electron transport", "children": [{"label": "Proton pumps"}]}, {"label": "ATP synthase", "children": [{"label": "Rotor"}, {"label": "Stator"}]}]})
    if '"events"' in prompt:
        return json.dumps({"events": [{"date": "1961", "title": "Chemiosmotic theory", "detail": "Mitchell proposes the proton gradient.", "source": "Lecture 7"}], "cast": [{"name": "Peter Mitchell", "description": "Proposed chemiosmosis"}]})
    return "## Key ideas\n\n- Electrons drive proton pumps.\n- The gradient spins ATP synthase.\n"


PAGE = ("<html><head><title>{title}</title></head><body><article><h1>{title}</h1><p>"
        + "ATP synthase is a rotary enzyme. Protons flowing through it turn its rotor, which drives the synthesis of ATP. " * 8
        + "</p></article></body></html>")


@app.get("/search")
def searxng(q: str, format: str = "json") -> dict:
    """Fake SearXNG: two results pointing at the pages below."""
    return {"results": [{"title": "How ATP synthase works", "url": "http://localhost:9100/pages/atp", "content": "A rotary motor."},
                        {"title": "Chemiosmosis history", "url": "http://localhost:9100/pages/history", "content": "Mitchell, 1961."}]}


@app.get("/pages/{name}")
def page(name: str) -> Response:
    title = {"atp": "How ATP synthase works", "history": "Chemiosmosis history"}.get(name, name)
    return Response(PAGE.format(title=title), media_type="text/html")


@app.get("/v1/models")
def models(kind: str | None = None) -> dict:
    return {"data": [{"id": "fake-model"}, {"id": "fake-model-large"}]}


@app.post("/v1/chat/completions")
async def chat(request: Request) -> StreamingResponse:
    body = await request.json()
    system = "\n".join(m["content"] for m in body["messages"] if m["role"] == "system")
    prompt = "\n".join(m["content"] for m in body["messages"] if m["role"] != "system")
    text = reply_for(system, prompt)

    def events():
        for i in range(0, len(text), 40):
            yield f"data: {json.dumps({'choices': [{'delta': {'content': text[i:i + 40]}}]})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")


VOICES = [{"voice_id": "aria", "name": "Aria", "category": "premade", "labels": {"accent": "american"}},
          {"voice_id": "theo", "name": "Theo", "category": "premade", "labels": {"accent": "british"}},
          {"voice_id": "george", "name": "George", "category": "premade", "labels": {}}]
FREQ = {"aria": 330, "theo": 220, "george": 180}


@app.get("/v1/voices")
def voices() -> dict:
    return {"voices": VOICES}


@app.get("/v1/projects")
def projects() -> list:
    return [{"slug": "inbox", "name": "Inbox"}, {"slug": "homl", "name": "Homl Learn"}]


@app.post("/v1/text-to-speech/{voice_id}")
async def tts(voice_id: str, request: Request) -> Response:
    body = await request.json()
    seconds = max(0.6, len(body["text"]) / 16)
    freq = FREQ.get(voice_id, 260)
    with tempfile.NamedTemporaryFile(suffix=".mp3") as tmp:
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"sine=frequency={freq}:duration={seconds:.2f}",
                        "-af", "volume=0.3", "-ac", "1", "-ar", "44100", tmp.name], check=True)
        return Response(open(tmp.name, "rb").read(), media_type="audio/mpeg")


@app.post("/v1/speech-to-text")
async def stt() -> dict:
    return {"text": "Why do the protons flow back in?", "language_code": "en", "words": []}
