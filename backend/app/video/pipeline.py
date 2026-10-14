"""Video Overview pipeline: script -> scene code check -> narration -> render -> mix -> verify.

The LLM follows the bundled SKILL.md and writes a scene plan against the scene kit (KIT.md). Narration
timing drives the animation: each scene lasts as long as its lines plus gaps, and every beat starts on a
line's first frame. Narration clips are cached by text and voice, so editing one line re-voices only it.
"""

from __future__ import annotations

import asyncio
import difflib
import hashlib
import json
import math
import re
import shutil
from pathlib import Path

import httpx

from .. import db, jsonutil, llm, media, retrieval, settings_store, voice
from ..config import get_config

HERE = Path(__file__).parent
SKILL = (HERE / "SKILL.md").read_text()
KIT = (HERE / "KIT.md").read_text()

FPS = 30
WIDTH, HEIGHT = 1920, 1080
LINE_GAP = 0.35   # seconds of silence after each line
SCENE_TAIL = 0.5  # extra seconds at the end of each scene
WORDS_PER_MINUTE = 130
LENGTHS = {"brief": 2.5, "standard": 6, "long": 10}
KIT_TYPES = {"Title", "Hook", "Definition", "Quote", "Steps", "Flow", "Comparison", "Timeline", "Chart",
             "Panels", "Cast", "Orbit", "Spectrum", "Recap"}
PALETTE_ACCENTS = {
    "deep-space": ["#F2B33D", "#FF7A59", "#5EE3C1", "#8FB8FF", "#F48FB1"],
    "reef": ["#FF8C6B", "#FFD166", "#B8F2E6", "#F7A1C4", "#9AD0FF"],
    "paper": ["#2F6F9F", "#C4472F", "#2E8B6A", "#8A4FB5", "#C77D10"],
}
STAGES = ["script", "scenes", "narration", "render", "verify"]
NAME_RE = re.compile(r"^[A-Z][A-Za-z0-9]{0,40}$")


class VideoError(RuntimeError):
    pass


def job_dir(notebook_id: str, artifact_id: str) -> Path:
    path = get_config().files_dir / notebook_id / "artifacts" / artifact_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def rel(path: Path) -> str:
    return str(path.relative_to(get_config().files_dir))


def word_count(spec: dict) -> int:
    return sum(len(line.split()) for s in spec["scenes"] for line in s["lines"])


# ---------------------------------------------------------------- script

def system_prompt(max_custom: int) -> str:
    return (
        SKILL
        + "\n\n"
        + KIT
        + f"\n\nUse at most {max_custom} custom scenes (0 is fine).\n\n"
        "Reply with JSON only, in this shape:\n"
        '{"title": "video title", "accent": "<one of the palette accents>", "scenes": [scene, ...], '
        '"report": {"covered": [{"point": "...", "scene": 3}], "gaps": ["key points not covered"], '
        '"own_wording": ["lines or facts that are your wording, not the sources\'"]}}'
    )


def brief_prompt(options: dict, sources: list[dict]) -> str:
    minutes = LENGTHS.get(options.get("length", "standard"), 6)
    palette = options.get("palette", "deep-space")
    parts = [
        f"Make a video of about {minutes} minutes, so about {int(minutes * WORDS_PER_MINUTE)} narration words in total.",
        f"Palette: {palette}. Accent colours to choose from: {', '.join(PALETTE_ACCENTS.get(palette, PALETTE_ACCENTS['deep-space']))}.",
        f"Purpose: {'exam revision: follow the sources closely' if options.get('purpose') == 'revision' else 'a general explainer'}.",
    ]
    if options.get("focus"):
        parts.append(f"Focus: {options['focus']}")
    if options.get("audience"):
        parts.append(f"Audience: {options['audience']}")
    language = settings_store.output_language(options)
    if language:
        parts.append(f"Narration language: {language}.")
    return "\n".join(parts) + "\n\n" + retrieval.format_sources(sources)


def normalise_spec(data: object, palette: str, max_custom: int) -> dict:
    if not isinstance(data, dict) or not isinstance(data.get("scenes"), list):
        raise ValueError("Expected an object with a scenes list.")
    accents = PALETTE_ACCENTS.get(palette, PALETTE_ACCENTS["deep-space"])
    accent = data.get("accent") if data.get("accent") in accents else accents[0]
    scenes, customs, names = [], 0, set()
    for raw in data["scenes"]:
        if not isinstance(raw, dict):
            continue
        lines = [str(x).strip() for x in raw.get("lines", []) if str(x).strip()]
        if not lines:
            continue
        scene = {"type": str(raw.get("type", "Panels")), "title": str(raw.get("title") or "")[:80],
                 "props": raw.get("props") if isinstance(raw.get("props"), dict) else {}, "lines": lines}
        if scene["type"] == "Custom":
            name = str(raw.get("name") or raw.get("props", {}).get("name") or "")
            code = raw.get("code")
            fallback = raw.get("fallback") if isinstance(raw.get("fallback"), dict) else {}
            if fallback.get("type") not in KIT_TYPES:
                fallback = {"type": "Panels", "props": {}}
            if customs < max_custom and NAME_RE.match(name) and name not in names and isinstance(code, str) and code.strip():
                customs += 1
                names.add(name)
                scene.update(custom=name, code=code, fallback=fallback)
            else:
                scene.update(type=fallback["type"], props=fallback.get("props") or {})
        elif scene["type"] not in KIT_TYPES:
            scene["type"] = "Panels"
        scenes.append(scene)
    if len(scenes) < 2:
        raise ValueError("The plan needs at least two scenes with narration.")
    report = data.get("report") if isinstance(data.get("report"), dict) else {}
    return {"title": str(data.get("title") or "Video overview")[:200], "palette": palette, "accent": accent,
            "scenes": scenes, "report": report}


async def write_script(options: dict, sources: list[dict], max_custom: int) -> dict:
    conn, model = settings_store.role("video")
    system = system_prompt(max_custom)
    messages = [{"role": "user", "content": brief_prompt(options, sources)}]
    raw = await llm.complete(conn, model, system, messages, json_mode=True, effort="high")
    try:
        spec = normalise_spec(jsonutil.extract_json(raw), options.get("palette", "deep-space"), max_custom)
    except ValueError as exc:
        messages += [{"role": "assistant", "content": raw},
                     {"role": "user", "content": f"That plan was not usable ({exc}). Reply with the corrected JSON only."}]
        raw = await llm.complete(conn, model, system, messages, json_mode=True, effort="high")
        spec = normalise_spec(jsonutil.extract_json(raw), options.get("palette", "deep-space"), max_custom)

    target = LENGTHS.get(options.get("length", "standard"), 6) * WORDS_PER_MINUTE
    words = word_count(spec)
    if words > target * 1.2:
        # Drafts run long; trim before paying for narration.
        messages += [{"role": "assistant", "content": raw},
                     {"role": "user", "content": f"The narration is {words} words; the target is about {int(target)}. "
                      "Trim lines (keep the structure, the key points and the custom scenes) and reply with the full corrected JSON only."}]
        try:
            raw = await llm.complete(conn, model, system, messages, json_mode=True, effort="high")
            spec = normalise_spec(jsonutil.extract_json(raw), options.get("palette", "deep-space"), max_custom)
        except (ValueError, llm.LLMError):
            pass  # keep the untrimmed plan rather than fail
    spec["report"]["words"] = word_count(spec)
    spec["report"]["minutes_estimate"] = round(spec["report"]["words"] / WORDS_PER_MINUTE, 1)
    return spec


# ---------------------------------------------------------------- renderer

def renderer_url() -> str:
    return get_config().renderer_url.rstrip("/")


async def check_custom(folder: Path, spec: dict) -> dict[str, str]:
    custom_dir = folder / "custom"
    shutil.rmtree(custom_dir, ignore_errors=True)
    custom_dir.mkdir(parents=True)
    for scene in spec["scenes"]:
        if scene.get("custom"):
            (custom_dir / f"{scene['custom']}.tsx").write_text(scene["code"])
    if not any(s.get("custom") for s in spec["scenes"]):
        return {}
    async with httpx.AsyncClient(timeout=300) as client:
        try:
            resp = await client.post(f"{renderer_url()}/check", json={"jobDir": str(folder)})
        except httpx.HTTPError as exc:
            raise VideoError(f"The video renderer is unreachable at {renderer_url()}: {exc}") from exc
    if resp.status_code >= 400:
        raise VideoError(f"Renderer check failed: {resp.text[:300]}")
    return resp.json().get("errors", {})


async def fix_custom(scene: dict, error: str) -> str | None:
    conn, model = settings_store.role("video")
    prompt = (
        f"This custom Remotion scene failed checks:\n{error}\n\nFix it and reply with the complete corrected "
        f"file only, in a ```tsx code block. Keep the default export name {scene['custom']}.\n\n```tsx\n{scene['code']}\n```"
    )
    try:
        raw = await llm.complete(conn, model, SKILL, [{"role": "user", "content": prompt}], effort="medium")
    except llm.LLMError:
        return None
    match = re.search(r"```(?:tsx|typescript|ts)?\s*(.*?)```", raw, re.DOTALL)
    return match.group(1).strip() if match else None


async def render(folder: Path, on_progress) -> dict:
    async with httpx.AsyncClient(timeout=60) as client:
        try:
            resp = await client.post(f"{renderer_url()}/jobs", json={"jobDir": str(folder)})
        except httpx.HTTPError as exc:
            raise VideoError(f"The video renderer is unreachable at {renderer_url()}: {exc}") from exc
    if resp.status_code >= 400:
        raise VideoError(f"Renderer refused the job: {resp.text[:300]}")
    job_id = resp.json()["id"]
    failures = 0
    while True:
        await asyncio.sleep(2)
        # A fresh connection per poll: the renderer's event loop can stall while bundling, which drops
        # kept-alive sockets. Tolerate a minute of missed polls before giving up.
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(f"{renderer_url()}/jobs/{job_id}")
            job = resp.json()
            failures = 0
        except (httpx.TransportError, ValueError):
            failures += 1
            if failures > 30:
                raise VideoError("Lost contact with the video renderer while it was rendering.")
            continue
        if resp.status_code == 404:
            raise VideoError("The renderer restarted and lost the job. Try again.")
        on_progress(job.get("stage", ""), job.get("progress") or 0)
        if job["status"] == "done":
            return job
        if job["status"] == "failed":
            raise VideoError("Rendering failed: " + (job.get("error") or "")[:800])


# ---------------------------------------------------------------- narration

def clip_key(cfg: dict, voice_id: str, speed: float | None, text: str) -> str:
    raw = f"{cfg.get('preset')}|{cfg.get('base_url')}|{cfg.get('model_id')}|{voice_id}|{speed}|{text}"
    return hashlib.sha1(raw.encode()).hexdigest()[:20]


def similarity(a: str, b: str) -> float:
    norm = lambda s: re.sub(r"[^\w\s]", "", s.lower()).split()  # noqa: E731
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio()


async def narrate(folder: Path, spec: dict, options: dict, on_progress) -> list[list[dict]]:
    """Synthesize every line; returns per scene a list of {path, seconds, flagged}."""
    cfg = settings_store.load()["voice"]
    voice_id = options.get("voice") or cfg.get("narrator")
    speed = options.get("speed")
    check = bool(options.get("check_narration"))
    total = sum(len(s["lines"]) for s in spec["scenes"])
    done = 0
    out: list[list[dict]] = []
    for scene in spec["scenes"]:
        scene_clips = []
        for text in scene["lines"]:
            clip = folder / "narration" / f"{clip_key(cfg, voice_id, speed, text)}.mp3"
            flagged = None
            if not clip.exists():
                await voice.synthesize(text, voice_id, clip, speed=speed, cfg=cfg)
                if check:
                    # Listen back with speech-to-text; retry once if the clip doesn't match the script.
                    heard = (await voice.transcribe(clip))["text"]
                    if similarity(text, heard) < 0.8:
                        await voice.synthesize(text, voice_id, clip, speed=speed, cfg=cfg)
                        heard = (await voice.transcribe(clip))["text"]
                        if similarity(text, heard) < 0.8:
                            flagged = heard
            seconds = len(await media.decode_pcm(clip)) / media.RATE
            scene_clips.append({"path": clip, "seconds": seconds, "flagged": flagged})
            done += 1
            on_progress(done, total)
        out.append(scene_clips)
    return out


def build_timeline(spec: dict, clips: list[list[dict]]) -> dict:
    """Frame-exact timing: scene durations and line start/end frames, plus absolute seconds."""
    scenes, absolute = [], 0
    for scene, scene_clips in zip(spec["scenes"], clips):
        t, lines = 0.0, []
        for text, clip in zip(scene["lines"], scene_clips):
            start = round(t * FPS)
            end = start + math.ceil(clip["seconds"] * FPS)
            lines.append({"text": text, "start": start, "end": end, "abs_start": (absolute + start) / FPS,
                          "seconds": clip["seconds"]})
            t = end / FPS + LINE_GAP
        duration = math.ceil((t + SCENE_TAIL) * FPS)
        scenes.append({"start": absolute, "durationInFrames": duration, "lines": lines})
        absolute += duration
    return {"fps": FPS, "totalFrames": absolute, "scenes": scenes}


def render_spec(spec: dict, timeline: dict) -> dict:
    scenes = []
    for scene, timing in zip(spec["scenes"], timeline["scenes"]):
        item = {"type": scene["type"], "props": scene["props"], "durationInFrames": timing["durationInFrames"],
                "lines": [{"text": ln["text"], "start": ln["start"], "end": ln["end"]} for ln in timing["lines"]]}
        if scene.get("custom"):
            item.update(custom=scene["custom"], fallback=scene.get("fallback"))
        scenes.append(item)
    return {"title": spec["title"], "palette": spec["palette"], "accent": spec["accent"], "fps": FPS,
            "width": WIDTH, "height": HEIGHT, "scenes": scenes}


def srt_time(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, rem = divmod(ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_subtitles(timeline: dict, path: Path) -> int:
    cues = []
    for scene in timeline["scenes"]:
        for line in scene["lines"]:
            cues.append(f"{len(cues) + 1}\n{srt_time(line['abs_start'])} --> "
                        f"{srt_time(line['abs_start'] + line['seconds'])}\n{line['text']}\n")
    path.write_text("\n".join(cues))
    # WebVTT copy for the browser player's subtitle track.
    vtt = "WEBVTT\n\n" + "\n".join(c.split("\n", 1)[1].replace(",", ".", 2) for c in cues)
    path.with_suffix(".vtt").write_text(vtt)
    return len(cues)


def write_chapters(spec: dict, timeline: dict, path: Path) -> None:
    out = [";FFMETADATA1", f"title={spec['title']}"]
    for i, (scene, timing) in enumerate(zip(spec["scenes"], timeline["scenes"]), start=1):
        start_ms = round(timing["start"] / FPS * 1000)
        end_ms = round((timing["start"] + timing["durationInFrames"]) / FPS * 1000)
        name = (scene.get("title") or scene["type"]).replace("=", "-").replace("\n", " ")
        out += ["[CHAPTER]", "TIMEBASE=1/1000", f"START={start_ms}", f"END={end_ms}", f"title={i}. {name}"]
    path.write_text("\n".join(out) + "\n")


async def mix_and_mux(folder: Path, spec: dict, timeline: dict, clips: list[list[dict]]) -> Path:
    paths, starts = [], []
    for scene_clips, timing in zip(clips, timeline["scenes"]):
        for clip, line in zip(scene_clips, timing["lines"]):
            paths.append(clip["path"])
            starts.append(line["abs_start"])
    total = timeline["totalFrames"] / FPS
    soundtrack = folder / "soundtrack.m4a"
    await media.place_clips(paths, starts, total, soundtrack)
    subs, chapters = folder / "subtitles.srt", folder / "chapters.txt"
    write_subtitles(timeline, subs)
    write_chapters(spec, timeline, chapters)
    final = folder / "video.mp4"
    await media.run(
        "ffmpeg", "-y", "-v", "error", "-i", str(folder / "silent.mp4"), "-i", str(soundtrack), "-i", str(subs),
        "-f", "ffmetadata", "-i", str(chapters), "-map", "0:v", "-map", "1:a", "-map", "2:s", "-map_metadata", "3",
        "-map_chapters", "3", "-c:v", "copy", "-c:a", "copy", "-c:s", "mov_text",
        "-metadata:s:s:0", "language=eng", "-movflags", "+faststart", str(final),
    )
    return final


# ---------------------------------------------------------------- verify

async def verify(final: Path, spec: dict, timeline: dict) -> list[dict]:
    info = await media.probe(final)
    streams = info.get("streams", [])
    v = next((s for s in streams if s["codec_type"] == "video"), {})
    a = next((s for s in streams if s["codec_type"] == "audio"), None)
    s = next((s for s in streams if s["codec_type"] == "subtitle"), None)
    expected = timeline["totalFrames"] / FPS
    duration = float(info["format"]["duration"])
    num, den = (v.get("r_frame_rate", "0/1").split("/") + ["1"])[:2]
    fps = float(num) / float(den or 1)
    chapter_info = json.loads(await media.run("ffprobe", "-v", "error", "-show_chapters", "-of", "json", str(final)))
    chapters = chapter_info.get("chapters", [])
    cue_count = (final.parent / "subtitles.srt").read_text().count(" --> ")
    line_count = sum(len(sc["lines"]) for sc in spec["scenes"])
    chapter_ok = len(chapters) == len(spec["scenes"]) and all(
        abs(float(c["start_time"]) - t["start"] / FPS) < 0.05 for c, t in zip(chapters, timeline["scenes"]))
    lufs = await media.loudness(final)
    a_dur = float(a.get("duration", 0)) if a else 0
    return [
        {"name": "Resolution", "ok": (v.get("width"), v.get("height")) == (WIDTH, HEIGHT), "detail": f"{v.get('width')}x{v.get('height')}"},
        {"name": "Frame rate", "ok": abs(fps - FPS) < 0.01, "detail": f"{fps:g} fps"},
        {"name": "Video codec", "ok": v.get("codec_name") == "h264", "detail": v.get("codec_name", "none")},
        {"name": "Length matches narration timing", "ok": abs(duration - expected) < 0.2, "detail": f"{duration:.2f}s vs {expected:.2f}s"},
        {"name": "Audio stream", "ok": a is not None, "detail": a.get("codec_name", "") if a else "missing"},
        {"name": "Audio covers the video", "ok": abs(a_dur - expected) < 0.3, "detail": f"{a_dur:.2f}s"},
        {"name": "Subtitle stream", "ok": s is not None, "detail": "mov_text" if s else "missing"},
        {"name": "One chapter per scene", "ok": chapter_ok, "detail": f"{len(chapters)} chapters, {len(spec['scenes'])} scenes"},
        {"name": "One subtitle cue per line", "ok": cue_count == line_count, "detail": f"{cue_count} cues, {line_count} lines"},
        {"name": "Loudness near -16 LUFS", "ok": lufs is not None and abs(lufs + 16) <= 2, "detail": f"{lufs} LUFS" if lufs is not None else "not measured"},
    ]


# ---------------------------------------------------------------- orchestration

async def generate(artifact_id: str, start_at: str = "script") -> None:
    art = db.fetch_one("SELECT * FROM artifacts WHERE id=?", (artifact_id,))
    if not art:
        return
    options = art["options"]
    data = dict(art["data"])
    folder = job_dir(art["notebook_id"], artifact_id)
    settings = settings_store.load()
    max_custom = int(options.get("max_custom_scenes", settings["video"].get("max_custom_scenes", 3)))
    first = STAGES.index(start_at) if start_at in STAGES else 0
    stages = {name: ("done" if i < first else "pending") for i, name in enumerate(STAGES)}

    def save(stage: str | None = None, done: float = 0, total: float = 0, **extra) -> None:
        if stage:
            for name in STAGES:
                if name == stage:
                    stages[name] = "running"
                    break
                stages[name] = "done"
        data.update(extra)
        db.update("artifacts", artifact_id, {
            "status": "running", "updated_at": db.now(), "data": data,
            "progress": {"stage": stage, "done": done, "total": total, "stages": stages},
        })

    if first == 0:
        save("script")
        conn, _ = settings_store.role("video")
        sources = retrieval.gather_sources(art["notebook_id"], options.get("source_ids") or None,
                                           budget_chars=retrieval.budget_for(conn, share=0.45))
        if not sources:
            raise VideoError("Select at least one ready source first.")
        spec = await write_script(options, sources, max_custom)
        db.update("artifacts", artifact_id, {"title": spec["title"]})
        data.update(spec=spec, checks=[], video=None, stills=[])
    spec = data["spec"]

    if first <= 1:
        save("scenes")
        errors = await check_custom(folder, spec)
        for scene in spec["scenes"]:
            name = scene.get("custom")
            if name and errors.get(name):
                fixed = await fix_custom(scene, errors[name])
                if fixed:
                    scene["code"] = fixed
        if errors:
            errors = await check_custom(folder, spec)
        data["custom_errors"] = errors

    save("narration")
    clips = await narrate(folder, spec, options, lambda d, t: save("narration", d, t))
    data["flagged_lines"] = [
        {"scene": si, "line": li, "text": spec["scenes"][si]["lines"][li], "heard": c["flagged"]}
        for si, scene_clips in enumerate(clips) for li, c in enumerate(scene_clips) if c["flagged"]
    ]
    timeline = build_timeline(spec, clips)
    (folder / "spec.json").write_text(json.dumps(render_spec(spec, timeline)))
    if first > 1:
        # Re-check custom scenes so edited code is written out again.
        data["custom_errors"] = await check_custom(folder, spec)

    save("render")
    job = await render(folder, lambda stage, p: save("render", round(p * 100), 100, render_stage=stage))
    data["custom_errors"] = {**data.get("custom_errors", {}), **job.get("failed", {})}
    final = await mix_and_mux(folder, spec, timeline, clips)

    save("verify")
    checks = await verify(final, spec, timeline)
    (folder / "silent.mp4").unlink(missing_ok=True)
    stills = [rel(folder / s) for s in job["result"]["stills"]]
    data.update(video=rel(final), stills=stills, checks=checks, duration=timeline["totalFrames"] / FPS,
                timeline=[{"start": t["start"] / FPS, "lines": [ln["abs_start"] for ln in t["lines"]]}
                          for t in timeline["scenes"]],
                subtitles=rel(folder / "subtitles.vtt"))
    for name in STAGES:
        stages[name] = "done"
    db.update("artifacts", artifact_id, {"status": "done", "updated_at": db.now(), "data": data,
                                         "progress": {"stage": "done", "stages": stages}})


async def redraw_scene(artifact_id: str, index: int, instruction: str) -> dict:
    """Ask the model for new visuals for one scene, keeping its narration."""
    art = db.fetch_one("SELECT * FROM artifacts WHERE id=?", (artifact_id,))
    spec = art["data"]["spec"]
    scene = spec["scenes"][index]
    conn, model = settings_store.role("video")
    prompt = (
        "Redesign the visuals for this one scene. Keep its narration lines exactly. "
        + (f"The viewer asked: {instruction}\n" if instruction else "")
        + "Reply with JSON only: one scene object (type, title, props, and for Custom: name, code, fallback).\n\n"
        + json.dumps({k: v for k, v in scene.items() if k != "code"}, indent=1)
    )
    raw = await llm.complete(conn, model, SKILL + "\n\n" + KIT, [{"role": "user", "content": prompt}],
                             json_mode=True, effort="high")
    new = jsonutil.extract_json(raw)
    if isinstance(new, dict):
        new["lines"] = scene["lines"]
    others = sum(1 for i, s in enumerate(spec["scenes"]) if s.get("custom") and i != index)
    max_custom = int(art["options"].get("max_custom_scenes", 3))
    fixed = normalise_spec({"scenes": [new, {"type": "Panels", "lines": ["-"]}]}, spec["palette"],
                           max(0, max_custom - others))["scenes"][0]
    if fixed.get("custom") and any(s.get("custom") == fixed["custom"] for i, s in enumerate(spec["scenes"]) if i != index):
        fixed["custom"] += str(index)
    spec["scenes"][index] = fixed
    data = {**art["data"], "spec": spec}
    db.update("artifacts", artifact_id, {"data": data, "updated_at": db.now()})
    return fixed
