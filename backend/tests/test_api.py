import asyncio
import json

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import VOICE_URL, configure_llm, configure_voice

SOURCE_TEXT = (
    "ATP synthase is a rotary enzyme in the inner mitochondrial membrane.\n\n"
    "The electron transport chain pumps protons into the intermembrane space, building a gradient.\n\n"
    "Protons flow back through ATP synthase, spinning its rotor and producing ATP from ADP and phosphate."
)


@pytest.fixture
def client(fake_llm):
    with TestClient(app) as c:
        yield c


def signed_in(client):
    assert client.get("/api/auth/status").json()["password_set"] is False
    assert client.post("/api/auth/setup", json={"password": "short"}).status_code == 400
    assert client.post("/api/auth/setup", json={"password": "long enough pw"}).status_code == 200
    return client


def wait_for(client, url, done=lambda r: r["status"] in ("ready", "done", "failed"), timeout=20):
    import time

    end = time.time() + timeout
    while time.time() < end:
        row = client.get(url).json()
        if done(row):
            return row
        time.sleep(0.1)
    raise AssertionError(f"timed out waiting for {url}: {row}")


def test_requires_sign_in(client):
    assert client.get("/api/notebooks").status_code == 401
    signed_in(client)
    assert client.get("/api/notebooks").status_code == 200
    client.post("/api/auth/logout")
    client.cookies.clear()
    assert client.post("/api/auth/login", json={"password": "nope"}).status_code == 401
    assert client.post("/api/auth/login", json={"password": "long enough pw"}).status_code == 200


def test_notebook_flow_sources_chat_studio(client, fake_llm):
    signed_in(client)
    configure_llm()
    fake_llm.replies = [
        ("Summarise this source", "About ATP synthase.\nTopics: ATP, protons"),
        ("a short notebook title", json.dumps({"title": "Cell Energy", "summary": "How cells make ATP.",
                                                           "questions": ["What spins ATP synthase?", "Q2", "Q3"]})),
        ("Source excerpts:", "Protons flow back through ATP synthase, spinning it [1]. It sits in the inner membrane [2]."),
        ('"cards"', json.dumps({"cards": [{"front": "What is ATP synthase?", "back": "A rotary enzyme"}]})),
        ("study guide", "## Key concepts\n- ATP synthase"),
    ]
    nb = client.post("/api/notebooks", json={}).json()
    src = client.post(f"/api/notebooks/{nb['id']}/sources/text", json={"title": "Lecture 7", "text": SOURCE_TEXT}).json()
    src = wait_for(client, f"/api/sources/{src['id']}")
    assert src["status"] == "ready", src
    assert src["summary"].startswith("About ATP")
    nb = wait_for(client, f"/api/notebooks/{nb['id']}", done=lambda r: r["questions"])
    assert nb["title"] == "Cell Energy" and len(nb["questions"]) == 3

    with client.stream("POST", f"/api/notebooks/{nb['id']}/chat", json={"message": "How is ATP made?"}) as resp:
        events = [json.loads(line[6:]) for line in resp.iter_lines() if line.startswith("data: ")]
    kinds = [e["type"] for e in events]
    assert kinds[0] == "citations" and kinds[-1] == "done" and "delta" in kinds
    done = events[-1]["message"]
    assert "[1]" in done["content"]
    assert [c["used"] for c in done["citations"]][:1] == [True]
    chat_prompt = fake_llm.requests[-1]["messages"][-1]["content"]
    assert '<excerpt n="1" source="Lecture 7">' in chat_prompt

    cards = client.post(f"/api/notebooks/{nb['id']}/artifacts", json={"kind": "flashcards", "options": {"count": 5}}).json()
    cards = wait_for(client, f"/api/artifacts/{cards['id']}")
    assert cards["status"] == "done", cards
    assert cards["data"]["cards"][0]["back"] == "A rotary enzyme"

    guide = client.post(f"/api/notebooks/{nb['id']}/artifacts", json={"kind": "study_guide"}).json()
    guide = wait_for(client, f"/api/artifacts/{guide['id']}")
    note = client.post(f"/api/artifacts/{guide['id']}/to-note").json()
    assert note["content"].startswith("## Key concepts")


def test_audio_overview_and_interactive_question(client, fake_llm, mp3_bytes):
    signed_in(client)
    configure_llm()
    configure_voice()
    script = {"title": "The cell's power plant", "turns": [
        {"speaker": "A", "text": "Today: how cells make energy."},
        {"speaker": "B", "text": "Wait, so protons spin a turbine?"},
        {"speaker": "A", "text": "Exactly, ATP synthase."}]}
    fake_llm.replies = [
        ("Summarise this source", "Summary"),
        ("called in with a question", json.dumps({"turns": [{"speaker": "B", "text": "Great question!"},
                                                             {"speaker": "A", "text": "The gradient drives it. Back to it."}]})),
        ("two-host audio conversation", json.dumps(script)),
    ]
    nb = client.post("/api/notebooks", json={"title": "Bio"}).json()
    src = client.post(f"/api/notebooks/{nb['id']}/sources/text", json={"title": "L7", "text": SOURCE_TEXT}).json()
    wait_for(client, f"/api/sources/{src['id']}")

    tts = fake_llm.router.post(url__regex=rf"{VOICE_URL}/v1/text-to-speech/.*").mock(
        return_value=httpx.Response(200, content=mp3_bytes))
    art = client.post(f"/api/notebooks/{nb['id']}/artifacts", json={"kind": "audio", "options": {"format": "deep_dive"}}).json()
    art = wait_for(client, f"/api/artifacts/{art['id']}", timeout=60)
    assert art["status"] == "done", art
    assert art["title"] == "The cell's power plant"
    voices_used = [str(c.request.url).rsplit("/", 1)[-1].split("?")[0] for c in tts.calls]
    assert voices_used == ["va", "vb", "va"]
    starts = [t["start"] for t in art["data"]["turns"]]
    assert starts[0] == 0 and starts == sorted(starts)
    audio = client.get(f"/api/files/{art['data']['audio']}")
    assert audio.status_code == 200 and audio.content[:3] in (b"ID3", b"\xff\xfb", b"\xff\xf3")

    fake_llm.router.post(f"{VOICE_URL}/v1/speech-to-text").mock(
        return_value=httpx.Response(200, json={"text": "Why do protons flow back?"}))
    reply = client.post(f"/api/artifacts/{art['id']}/interject", data={"position": "1.0"},
                        files={"audio": ("q.webm", b"fake-audio", "audio/webm")})
    assert reply.status_code == 200, reply.text
    body = reply.json()
    assert body["question"] == "Why do protons flow back?"
    assert len(body["turns"]) == 2
    assert client.get(f"/api/files/{body['audio']}").status_code == 200


def test_files_endpoint_blocks_traversal(client):
    signed_in(client)
    assert client.get("/api/files/../homl.sqlite3").status_code == 404
    assert client.get("/api/files/%2e%2e/homl.sqlite3").status_code == 404


def test_settings_lists_models_and_hides_keys(client, fake_llm):
    signed_in(client)
    configure_llm()
    s = client.get("/api/settings").json()
    assert s["settings"]["connections"]["c1"]["has_key"] is True
    assert "sk-test" not in json.dumps(s)
    assert any(p["id"] == "10labs" for p in s["presets"]["voice"])
    models = client.post("/api/llm/models", json={"connection_id": "c1"}).json()
    assert models["models"] == ["m1", "m2"]
