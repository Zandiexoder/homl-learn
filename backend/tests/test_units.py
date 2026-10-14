import numpy as np
import pytest

from app import jsonutil, llm, retrieval, security, settings_store, voice
from app.video import pipeline


def test_chunker_keeps_pages_and_overlap():
    pages = [(1, "Alpha paragraph. " * 40), (2, "Beta paragraph. " * 120)]
    chunks = retrieval.chunk_text("", pages)
    assert chunks[0]["page"] == 1
    assert any(c["page"] == 2 for c in chunks)
    assert all(len(c["text"]) <= retrieval.CHUNK_CHARS + 2 for c in chunks)
    # Nothing is lost: every sentence of the input appears in some chunk.
    assert "Beta paragraph." in chunks[-1]["text"]


def test_chunker_short_text_single_chunk():
    assert retrieval.chunk_text("Just one line.") == [{"text": "Just one line.", "page": None}]


def test_bm25_prefers_matching_doc():
    docs = [retrieval.tokenize(t) for t in ["cats purr softly", "proton gradient drives ATP synthase", "dogs bark"]]
    scores = retrieval.bm25_scores(retrieval.tokenize("how does ATP synthase work"), docs)
    assert int(np.argmax(scores)) == 1


@pytest.mark.parametrize("text,expected", [
    ('Sure! ```json\n{"a": 1}\n``` done', {"a": 1}),
    ('Here you go: {"turns": [{"speaker": "A", "text": "hi {there}"}]} thanks', {"turns": [{"speaker": "A", "text": "hi {there}"}]}),
    ("[1, 2, 3]", [1, 2, 3]),
])
def test_extract_json(text, expected):
    assert jsonutil.extract_json(text) == expected


def test_extract_json_failure():
    with pytest.raises(jsonutil.JSONExtractError):
        jsonutil.extract_json("no json here")


def test_think_filter_strips_reasoning_across_chunks():
    f = llm.ThinkFilter()
    out = "".join(f.feed(p) for p in ["Hel", "lo <thi", "nk>secret plan</th", "ink> world"]) + f.flush()
    assert out == "Hello  world"


def test_split_for_tts_respects_limit():
    text = ("This is a sentence. " * 600).strip()
    parts = voice.split_for_tts(text, limit=4500)
    assert all(len(p) <= 4500 for p in parts)
    assert " ".join(parts).split() == text.split()


def test_api_keys_encrypted_and_masked(data_dir):
    settings_store.save({"connections": {"c1": {"kind": "openai", "base_url": "http://x/v1", "api_key": "sk-secret"}}})
    raw = (data_dir / "homl.sqlite3").read_bytes()
    assert b"sk-secret" not in raw
    assert settings_store.load()["connections"]["c1"]["api_key"] == "sk-secret"
    public = settings_store.public()["connections"]["c1"]
    assert public["has_key"] is True and "api_key" not in public
    # Saving without api_key keeps the stored key; "" clears it.
    settings_store.save({"connections": {"c1": {"kind": "openai", "base_url": "http://y/v1"}}})
    assert settings_store.load()["connections"]["c1"]["api_key"] == "sk-secret"
    settings_store.save({"connections": {"c1": {"api_key": ""}}})
    assert settings_store.load()["connections"]["c1"]["api_key"] == ""


def test_password_hash_roundtrip():
    stored = security.hash_password("correct horse")
    assert security._verify_hash("correct horse", stored)
    assert not security._verify_hash("wrong", stored)


def test_normalise_spec_limits_custom_and_fixes_types():
    data = {"accent": "#000000", "scenes": [
        {"type": "Title", "props": {"title": "T"}, "lines": ["Hello there."]},
        {"type": "Custom", "name": "Spin", "code": "export default 1", "fallback": {"type": "Flow", "props": {}}, "lines": ["a"]},
        {"type": "Custom", "name": "Spin2", "code": "x", "fallback": {"type": "Steps", "props": {"steps": []}}, "lines": ["b"]},
        {"type": "Mystery", "lines": ["c"]},
        {"type": "Recap", "lines": []},
    ]}
    spec = pipeline.normalise_spec(data, "deep-space", max_custom=1)
    types = [s["type"] for s in spec["scenes"]]
    assert types == ["Title", "Custom", "Steps", "Panels"]  # second custom falls back; empty scene dropped
    assert spec["accent"] == pipeline.PALETTE_ACCENTS["deep-space"][0]


def test_timeline_frames_and_subtitles(tmp_path):
    spec = {"title": "T", "palette": "deep-space", "accent": "#F2B33D", "scenes": [
        {"type": "Title", "title": "Intro", "props": {}, "lines": ["one", "two"]},
        {"type": "Recap", "title": "End", "props": {}, "lines": ["three"]},
    ]}
    clips = [[{"seconds": 1.0}, {"seconds": 2.0}], [{"seconds": 1.5}]]
    tl = pipeline.build_timeline(spec, clips)
    first = tl["scenes"][0]
    assert first["lines"][0]["start"] == 0 and first["lines"][0]["end"] == 30
    assert first["lines"][1]["start"] == round((1.0 + 0.35) * 30)
    assert tl["scenes"][1]["start"] == first["durationInFrames"]
    assert tl["totalFrames"] == sum(s["durationInFrames"] for s in tl["scenes"])
    n = pipeline.write_subtitles(tl, tmp_path / "s.srt")
    assert n == 3 and "00:00:00,000 --> 00:00:01,000" in (tmp_path / "s.srt").read_text()
    pipeline.write_chapters(spec, tl, tmp_path / "c.txt")
    assert (tmp_path / "c.txt").read_text().count("[CHAPTER]") == 2


def test_similarity_ignores_punctuation():
    assert pipeline.similarity("Hello, world!", "hello world") == 1.0
    assert pipeline.similarity("The cat sat", "A dog ran away") < 0.5
