"""Web research: plan searches, read results, write a cited report and recommend sources to import.

Fast mode works from search snippets. Deep mode reads the pages and runs a second round of searches
for the gaps the first round left. Both need a SearXNG instance (Settings → Search).
"""

from __future__ import annotations

import asyncio

from . import db, ingest, jsonutil, llm, settings_store

PAGE_CHARS = 6000
MAX_RESULTS = {"fast": 8, "deep": 14}


async def plan_queries(question: str, context: str, count: int, avoid: list[str] | None = None) -> list[str]:
    conn, model = settings_store.role("chat")
    prompt = (
        f"Plan {count} web search queries to research this question thoroughly. Vary them: definitions, "
        "evidence, recent developments, opposing views, primary sources.\n"
        + (f"Already searched (find what these missed): {avoid}\n" if avoid else "")
        + (f"What the user's notebook already covers: {context[:1500]}\n" if context else "")
        + f'Question: {question}\n\nReply with JSON only: {{"queries": ["..."]}}'
    )
    raw = await llm.complete(conn, model, "", [{"role": "user", "content": prompt}], json_mode=True, effort="low")
    try:
        queries = [str(q).strip() for q in jsonutil.extract_json(raw).get("queries", []) if str(q).strip()]
    except (jsonutil.JSONExtractError, AttributeError):
        queries = []
    return queries[:count] or [question]


async def search_all(queries: list[str], seen: set[str], limit: int) -> list[dict]:
    hits: list[dict] = []
    for query in queries:
        try:
            results = await ingest.discover(query)
        except ingest.IngestError:
            raise
        except Exception:  # noqa: BLE001 - one failed query shouldn't end the research
            continue
        for r in results[:4]:
            if r["url"] not in seen and len(hits) < limit:
                seen.add(r["url"])
                hits.append({**r, "query": query})
    return hits


async def read_pages(hits: list[dict]) -> None:
    sem = asyncio.Semaphore(4)

    async def read(hit: dict) -> None:
        async with sem:
            try:
                title, text, _ = await asyncio.wait_for(ingest.fetch_web(hit["url"]), timeout=45)
                hit["title"] = title if title and title != hit["url"] else hit["title"]
                hit["text"] = text[:PAGE_CHARS]
            except Exception:  # noqa: BLE001 - unreadable pages fall back to their snippet
                hit["text"] = ""

    await asyncio.gather(*(read(h) for h in hits))


def numbered(hits: list[dict]) -> str:
    return "\n\n".join(
        f'<result n="{i}" title="{h["title"]}" url="{h["url"]}">\n{h.get("text") or h.get("snippet", "")}\n</result>'
        for i, h in enumerate(hits, start=1)
    )


async def generate(artifact_id: str) -> None:
    art = db.fetch_one("SELECT * FROM artifacts WHERE id=?", (artifact_id,))
    if not art:
        return
    options = art["options"]
    question = str(options.get("query") or "").strip()
    if not question:
        raise ValueError("Enter a research question.")
    mode = "deep" if options.get("mode") == "deep" else "fast"
    notebook = db.fetch_one("SELECT summary FROM notebooks WHERE id=?", (art["notebook_id"],)) or {}

    def progress(stage: str, done: int = 0, total: int = 0) -> None:
        db.update("artifacts", artifact_id, {"status": "running", "updated_at": db.now(),
                                             "progress": {"stage": stage, "done": done, "total": total}})

    progress("planning")
    queries = await plan_queries(question, notebook.get("summary") or "", 3 if mode == "fast" else 5)
    seen: set[str] = set()
    progress("searching")
    hits = await search_all(queries, seen, MAX_RESULTS[mode])
    if mode == "deep":
        progress("reading", 0, len(hits))
        await read_pages(hits)
        more = await plan_queries(question, numbered(hits)[:3000], 3, avoid=queries)
        queries += more
        progress("searching")
        extra = await search_all(more, seen, 6)
        progress("reading", len(hits), len(hits) + len(extra))
        await read_pages(extra)
        hits += extra
    if not hits:
        raise ValueError("The search found nothing. Try rephrasing the question.")

    progress("writing")
    conn, model = settings_store.role("studio")
    length = "a thorough report of 600-1000 words with headings" if mode == "deep" else "a brief of 150-300 words"
    prompt = (
        f"Research question: {question}\n\nUsing only the search results below, write {length} in Markdown. "
        "Cite results with their numbers in square brackets, like [3]. Say where results disagree or where "
        "evidence is thin. Then choose the results most worth adding to the notebook as sources (reliable, "
        "substantial, on topic).\n"
        'Reply with JSON only: {"report": "markdown", "recommended": [{"n": 1, "why": "one line"}]}\n\n'
        + numbered(hits)
    )
    raw = await llm.complete(conn, model, "", [{"role": "user", "content": prompt}], json_mode=True,
                             effort="high" if mode == "deep" else "medium")
    out = jsonutil.extract_json(raw)
    report = str(out.get("report") or "").strip() if isinstance(out, dict) else ""
    if not report:
        raise ValueError("The model didn't return a report.")
    recommended = []
    for rec in out.get("recommended", []) if isinstance(out, dict) else []:
        n = rec.get("n") if isinstance(rec, dict) else None
        if isinstance(n, int) and 1 <= n <= len(hits):
            h = hits[n - 1]
            recommended.append({"n": n, "title": h["title"], "url": h["url"], "why": str(rec.get("why") or "")})
    references = [{"n": i, "title": h["title"], "url": h["url"], "read": bool(h.get("text"))}
                  for i, h in enumerate(hits, start=1)]
    # Keep the numbered references with the report, so notes, exports and share links stay cited.
    report += "\n\n## References\n\n" + "\n".join(f"{r['n']}. [{r['title']}]({r['url']})" for r in references)
    db.update("artifacts", artifact_id, {
        "status": "done", "updated_at": db.now(), "progress": {"stage": "done"},
        "title": question[:120],
        "data": {"markdown": report, "references": references, "recommended": recommended,
                 "queries": queries, "mode": mode},
    })
