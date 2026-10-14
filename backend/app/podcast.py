"""Audio Overview: a two-host conversation about the sources, and live questions from the listener."""

from __future__ import annotations

import hashlib
from pathlib import Path

from . import db, jsonutil, llm, media, retrieval, settings_store, voice
from .config import get_config

FORMATS = {
    "deep_dive": "A lively deep dive. Host A guides; Host B asks the questions a curious listener would and "
                 "pushes for examples. Unpack the ideas, connect them, and land the key takeaways.",
    "brief": "A quick briefing that covers only the core ideas, with little banter.",
    "critique": "An expert review. The hosts assess the sources' arguments, evidence and gaps, with "
                "constructive suggestions.",
    "debate": "A respectful debate. Host A and Host B take different positions the sources support, argue "
              "them with evidence, and close by naming where they agree.",
}
WORDS = {"brief": 350, "short": 900, "default": 1900, "long": 3400}


def artifact_dir(notebook_id: str, artifact_id: str) -> Path:
    path = get_config().files_dir / notebook_id / "artifacts" / artifact_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def rel(path: Path) -> str:
    return str(path.relative_to(get_config().files_dir))


def script_prompt(options: dict, sources: list[dict]) -> str:
    fmt = options.get("format", "deep_dive")
    length = "brief" if fmt == "brief" else options.get("length", "default")
    words = WORDS.get(length, WORDS["default"])
    lines = [
        "Write the script for a two-host audio conversation about the sources below.",
        f"Style: {FORMATS.get(fmt, FORMATS['deep_dive'])}",
        f"Length: about {words} spoken words in total.",
        "Write for the ear: short sentences, natural reactions ('Right.', 'Wait, so...'), no stage "
        "directions, no sound effects, no markdown, no emoji. Spell out symbols and abbreviations the way "
        "they should be said. Hosts do not use each other's names.",
        "Stay faithful to the sources. Say which source an idea comes from when it helps. Never invent "
        "statistics or quotes.",
        'Reply with JSON only: {"title": "episode title", "turns": [{"speaker": "A", "text": "..."}, '
        '{"speaker": "B", "text": "..."}]}',
    ]
    if options.get("focus"):
        lines.append(f"The listener asked the hosts to focus on: {options['focus']}")
    language = settings_store.output_language(options)
    if language:
        lines.append(f"The whole conversation is in {language}.")
    return "\n".join(lines) + "\n\n" + retrieval.format_sources(sources)


def clean_turns(data: object) -> list[dict]:
    turns = data.get("turns", []) if isinstance(data, dict) else []
    out = []
    for t in turns:
        if not isinstance(t, dict) or not str(t.get("text", "")).strip():
            continue
        speaker = "B" if str(t.get("speaker", "A")).strip().upper().startswith("B") else "A"
        out.append({"speaker": speaker, "text": str(t["text"]).strip()})
    if len(out) < 2:
        raise ValueError("The script has fewer than two turns.")
    return out


async def speak_turns(turns: list[dict], folder: Path, cfg: dict, on_progress=None) -> list[Path]:
    """Synthesize each turn, reusing clips whose text and voice have not changed."""
    voices = {"A": cfg.get("host_a"), "B": cfg.get("host_b")}
    clips = []
    for i, turn in enumerate(turns):
        voice_id = voices[turn["speaker"]]
        key = hashlib.sha1(f"{cfg.get('preset')}|{cfg.get('model_id')}|{voice_id}|{turn['text']}".encode()).hexdigest()[:16]
        clip = folder / "clips" / f"{key}.mp3"
        if not clip.exists():
            await voice.synthesize(turn["text"], voice_id, clip, cfg=cfg)
        clips.append(clip)
        if on_progress:
            on_progress(i + 1, len(turns))
    return clips


def gaps_for(turns: list[dict]) -> list[float]:
    """Short gaps for quick back-and-forth, longer when the speaker changes after a long turn."""
    gaps = []
    for i, turn in enumerate(turns):
        nxt = turns[i + 1] if i + 1 < len(turns) else None
        if nxt is None:
            gaps.append(0.0)
        elif nxt["speaker"] == turn["speaker"]:
            gaps.append(0.35)
        else:
            gaps.append(0.12 if len(nxt["text"]) < 40 else 0.28)
    return gaps


async def generate(artifact_id: str) -> None:
    art = db.fetch_one("SELECT * FROM artifacts WHERE id=?", (artifact_id,))
    if not art:
        return
    options = art["options"]

    def progress(stage: str, done: int = 0, total: int = 0) -> None:
        db.update("artifacts", artifact_id, {"status": "running", "updated_at": db.now(),
                                             "progress": {"stage": stage, "done": done, "total": total}})

    progress("script")
    conn, model = settings_store.role("studio")
    sources = retrieval.gather_sources(art["notebook_id"], options.get("source_ids") or None,
                                       budget_chars=retrieval.budget_for(conn))
    if not sources:
        raise ValueError("Select at least one ready source first.")
    raw = await llm.complete(conn, model, "", [{"role": "user", "content": script_prompt(options, sources)}],
                             json_mode=True, effort="medium")
    data = jsonutil.extract_json(raw)
    turns = clean_turns(data)
    title = str(data.get("title") or art["title"])[:200]
    db.update("artifacts", artifact_id, {"title": title, "data": {"turns": turns}})

    cfg = settings_store.load()["voice"]
    folder = artifact_dir(art["notebook_id"], artifact_id)
    clips = await speak_turns(turns, folder, cfg, lambda d, t: progress("voices", d, t))
    progress("mixing")
    out = folder / "overview.mp3"
    starts = await media.join_clips(clips, gaps_for(turns), out)
    for turn, start in zip(turns, starts):
        turn["start"] = start
    total = await media.duration(out)
    db.update("artifacts", artifact_id, {
        "status": "done", "updated_at": db.now(), "progress": {"stage": "done"},
        "data": {"turns": turns, "audio": rel(out), "duration": round(total, 2),
                 "voices": {"A": cfg.get("host_a"), "B": cfg.get("host_b")}, "provider": cfg.get("preset")},
    })


INTERJECT_PROMPT = """You are writing the next few lines of a live two-host audio conversation. A listener has \
just called in with a question. Here is the conversation so far (most recent last):

{transcript}

Relevant source excerpts:
{excerpts}

The listener asks: "{question}"

Write 2-4 short turns where the hosts welcome the question, answer it from the sources (say so if the sources \
don't cover it), and then smoothly hand back to where they were. Write for the ear. Reply with JSON only: \
{{"turns": [{{"speaker": "A", "text": "..."}}]}}"""


async def interject(artifact_id: str, question: str, position: float) -> dict:
    art = db.fetch_one("SELECT * FROM artifacts WHERE id=?", (artifact_id,))
    if not art or art["kind"] != "audio" or art["status"] != "done":
        raise ValueError("This audio overview isn't ready.")
    turns = art["data"]["turns"]
    heard = [t for t in turns if t.get("start", 0) <= position] or turns[:1]
    transcript = "\n".join(f"Host {t['speaker']}: {t['text']}" for t in heard[-12:])
    excerpts = await retrieval.search(art["notebook_id"], question, source_ids=art["options"].get("source_ids") or None, k=5)
    excerpt_text = "\n\n".join(f"[{e['source_title']}] {e['text']}" for e in excerpts) or "(none found)"
    conn, model = settings_store.role("chat")
    prompt = INTERJECT_PROMPT.format(transcript=transcript, excerpts=excerpt_text, question=question)
    raw = await llm.complete(conn, model, "", [{"role": "user", "content": prompt}], json_mode=True, effort="low")
    reply = clean_turns(jsonutil.extract_json(raw))
    cfg = settings_store.load()["voice"]
    folder = artifact_dir(art["notebook_id"], artifact_id)
    clips = await speak_turns(reply, folder, cfg)
    out = folder / "interjections" / f"{db.new_id()}.mp3"
    await media.join_clips(clips, gaps_for(reply), out, tail=0.3)
    return {"question": question, "turns": reply, "audio": rel(out)}
