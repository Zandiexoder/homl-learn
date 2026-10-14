"""Studio outputs: reports, study aids and structured views generated from the sources."""

from __future__ import annotations

from . import db, jsonutil, llm, retrieval, settings_store

COMMON = (
    "Work only from the sources below. Keep their terminology and definitions. "
    "Where you add connective explanation that is not in the sources, keep it brief. "
    "Never invent figures, dates or quotes."
)

MARKDOWN_KINDS = {
    "study_guide": (
        "Study guide",
        "Write a study guide in Markdown with these sections: '## Key concepts' (bulleted, one line each), "
        "'## Short-answer quiz' ({count} questions), '## Answer key', '## Essay questions' (4 questions, "
        "no answers), and '## Glossary' (key terms with one-sentence definitions).",
    ),
    "briefing": (
        "Briefing doc",
        "Write a briefing document in Markdown for a busy reader: a one-paragraph executive summary, then "
        "'## Main themes' with the most important ideas and supporting detail, then '## Notable quotes' "
        "(short, exact quotes with the source title), then '## Open questions'.",
    ),
    "faq": (
        "FAQ",
        "Write an FAQ in Markdown: {count} questions a newcomer would ask, each as a '### ' heading followed "
        "by a clear answer of 2-4 sentences.",
    ),
    "report": (
        "Report",
        "Write a well-structured Markdown report with headings, covering the sources in depth.",
    ),
}

JSON_KINDS = {
    "slides": (
        "Slide deck",
        'Reply with JSON only: {{"title": "deck title", "subtitle": "...", "slides": [slide, ...]}}. Make {count} '
        'slides that teach the sources in a logical order. Each slide is one of: '
        '{{"layout": "section", "title": "..."}} for a new part; '
        '{{"layout": "bullets", "title": "...", "bullets": ["3-5 points of at most 12 words"], "notes": "speaker notes"}}; '
        '{{"layout": "two_column", "title": "...", "left": {{"heading": "...", "bullets": [...]}}, "right": {{"heading": "...", "bullets": [...]}}, "notes": "..."}} for comparisons; '
        '{{"layout": "quote", "quote": "a short exact quote", "attribution": "source title", "notes": "..."}}. '
        "End with a summary slide. Put detail in the notes, not on the slide.",
    ),
    "infographic": (
        "Infographic",
        'Reply with JSON only: {{"title": "max 8 words", "subtitle": "one sentence", '
        '"stats": [{{"value": "a figure stated in the sources", "label": "max 6 words"}}], '
        '"sections": [{{"heading": "max 4 words", "text": "max 22 words"}}], '
        '"steps": ["optional process steps, max 6 words each"], "takeaway": "one sentence", "source": "source titles"}}. '
        "Use 0-4 stats and only numbers that appear in the sources (an empty list is fine), 3-4 sections and 0-5 steps.",
    ),
    "timeline": (
        "Timeline",
        'Reply with JSON only: {{"events": [{{"date": "as precise as the sources allow", "title": "...", '
        '"detail": "1-2 sentences", "source": "source title"}}], "cast": [{{"name": "...", '
        '"description": "who they are and their role"}}]}}. Order events chronologically. '
        "If the sources have no dated events, return an empty events list.",
    ),
    "mindmap": (
        "Mind map",
        'Reply with JSON only: a tree {{"label": "central topic", "children": [{{"label": "...", '
        '"children": [...]}}]}}. 4-7 main branches, at most 4 levels deep, labels of at most 6 words.',
    ),
    "flashcards": (
        "Flashcards",
        'Reply with JSON only: {{"cards": [{{"front": "a question or term", "back": "a concise answer", '
        '"source": "source title"}}]}}. Make {count} cards at {difficulty} difficulty.',
    ),
    "quiz": (
        "Quiz",
        'Reply with JSON only: {{"questions": [{{"question": "...", "options": ["four options"], '
        '"answer": 0, "explanation": "why, citing the source"}}]}} where answer is the index of the correct '
        "option. Make {count} questions at {difficulty} difficulty with plausible wrong options.",
    ),
}

KINDS = {**MARKDOWN_KINDS, **JSON_KINDS}
DEFAULT_COUNT = {"study_guide": 10, "faq": 10, "flashcards": 20, "quiz": 10, "slides": 10}
SLIDE_LAYOUTS = {"section", "bullets", "two_column", "quote"}


def default_title(kind: str) -> str:
    return KINDS[kind][0]


def build_prompt(kind: str, options: dict, sources: list[dict]) -> str:
    instructions = KINDS[kind][1].format(
        count=int(options.get("count") or DEFAULT_COUNT.get(kind, 10)),
        difficulty=options.get("difficulty") or "medium",
    )
    extra = []
    if options.get("focus"):
        extra.append(f"Focus on: {options['focus']}")
    if options.get("prompt"):
        extra.append(f"The reader's instructions: {options['prompt']}")
    language = settings_store.output_language(options)
    if language:
        extra.append(f"Write in {language}.")
    return "\n".join([instructions, COMMON, *extra, "", retrieval.format_sources(sources)])


def validate(kind: str, data: object) -> dict:
    if kind == "mindmap":
        if not isinstance(data, dict) or "label" not in data:
            raise ValueError("Mind map is missing its central label.")
        return data
    if not isinstance(data, dict):
        raise ValueError("Expected a JSON object.")
    if kind == "flashcards":
        cards = [c for c in data.get("cards", []) if isinstance(c, dict) and c.get("front") and c.get("back")]
        if not cards:
            raise ValueError("No flashcards were produced.")
        return {"cards": cards}
    if kind == "quiz":
        questions = []
        for q in data.get("questions", []):
            opts = q.get("options") if isinstance(q, dict) else None
            if not opts or not isinstance(q.get("answer"), int) or not 0 <= q["answer"] < len(opts):
                continue
            questions.append(q)
        if not questions:
            raise ValueError("No valid quiz questions were produced.")
        return {"questions": questions}
    if kind == "slides":
        slides = []
        for s in data.get("slides", []):
            if not isinstance(s, dict):
                continue
            layout = s.get("layout") if s.get("layout") in SLIDE_LAYOUTS else "bullets"
            if layout == "quote" and not s.get("quote"):
                continue
            if layout != "quote" and not s.get("title"):
                continue
            slides.append({**s, "layout": layout})
        if not slides:
            raise ValueError("No usable slides were produced.")
        return {"title": str(data.get("title") or "Slides"), "subtitle": str(data.get("subtitle") or ""), "slides": slides}
    if kind == "infographic":
        if not data.get("title") or not isinstance(data.get("sections"), list) or not data["sections"]:
            raise ValueError("The infographic needs a title and sections.")
        return {
            "title": str(data["title"]), "subtitle": str(data.get("subtitle") or ""),
            "stats": [s for s in data.get("stats", []) if isinstance(s, dict) and s.get("value")][:4],
            "sections": [s for s in data["sections"] if isinstance(s, dict) and s.get("heading")][:4],
            "steps": [str(s) for s in data.get("steps", []) if s][:5],
            "takeaway": str(data.get("takeaway") or ""), "source": str(data.get("source") or ""),
        }
    if kind == "timeline":
        return {"events": data.get("events", []), "cast": data.get("cast", [])}
    return data


async def generate(artifact_id: str) -> None:
    art = db.fetch_one("SELECT * FROM artifacts WHERE id=?", (artifact_id,))
    if not art:
        return
    db.update("artifacts", artifact_id, {"status": "running", "updated_at": db.now()})
    options = art["options"]
    conn, model = settings_store.role("studio")
    sources = retrieval.gather_sources(art["notebook_id"], options.get("source_ids") or None,
                                       budget_chars=retrieval.budget_for(conn))
    if not sources:
        raise ValueError("Select at least one ready source first.")
    prompt = build_prompt(art["kind"], options, sources)
    is_json = art["kind"] in JSON_KINDS
    messages = [{"role": "user", "content": prompt}]
    raw = await llm.complete(conn, model, "", messages, json_mode=is_json, effort="medium")
    if is_json:
        try:
            data = validate(art["kind"], jsonutil.extract_json(raw))
        except ValueError as exc:
            # One repair attempt with the error shown to the model.
            messages += [{"role": "assistant", "content": raw},
                         {"role": "user", "content": f"That was not usable ({exc}). Reply with the corrected JSON only."}]
            raw = await llm.complete(conn, model, "", messages, json_mode=True, effort="medium")
            data = validate(art["kind"], jsonutil.extract_json(raw))
    else:
        data = {"markdown": raw}
    if art["kind"] in ("slides", "infographic") and data.get("title"):
        db.update("artifacts", artifact_id, {"title": data["title"][:200]})
    if art["kind"] == "infographic":
        db.update("artifacts", artifact_id, {"data": data, "progress": {"stage": "render"}, "updated_at": db.now()})
        data["image"] = await render_infographic(art, data)
    db.update("artifacts", artifact_id, {"status": "done", "data": data, "updated_at": db.now()})


async def render_infographic(art: dict, data: dict) -> str:
    """Draw the infographic as a PNG with the video renderer's Remotion kit."""
    import json

    from .video import pipeline

    folder = pipeline.job_dir(art["notebook_id"], art["id"])
    palette = art["options"].get("palette") or "paper"
    accents = pipeline.PALETTE_ACCENTS.get(palette, pipeline.PALETTE_ACCENTS["paper"])
    (folder / "still.json").write_text(json.dumps({"kind": "infographic", "palette": palette, "accent": accents[0], "data": data}))
    result = await pipeline.render_still(folder)
    return pipeline.rel(folder / result["image"])
