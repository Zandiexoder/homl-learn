import json
import subprocess
from pathlib import Path

import httpx
import pytest
import respx

from app import config, db

LLM_URL = "http://llm.test/v1"
VOICE_URL = "http://voice.test"


@pytest.fixture(scope="session")
def mp3_bytes(tmp_path_factory) -> bytes:
    out = tmp_path_factory.mktemp("audio") / "tone.mp3"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.6",
                    "-ac", "1", "-ar", "24000", str(out)], check=True)
    return out.read_bytes()


@pytest.fixture(autouse=True)
def data_dir(tmp_path):
    cfg = config.Config(data_dir=tmp_path, secret_key="test-secret", app_password=None,
                        renderer_url="http://renderer.test", static_dir=None, cookie_secure=False)
    (tmp_path / "files").mkdir()
    config.set_config(cfg)
    db.init_db()
    yield tmp_path


def sse(text: str) -> httpx.Response:
    """An OpenAI-style streaming response that sends text in a few chunks."""
    pieces = [text[i:i + 7] for i in range(0, len(text), 7)] or [""]
    body = "".join(f"data: {json.dumps({'choices': [{'delta': {'content': p}}]})}\n\n" for p in pieces)
    return httpx.Response(200, text=body + "data: [DONE]\n\n", headers={"content-type": "text/event-stream"})


class FakeLLM:
    """Routes prompts to canned replies by keyword. replies: list of (keyword, reply or callable)."""

    def __init__(self) -> None:
        self.replies: list = []
        self.requests: list[dict] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        self.requests.append(body)
        prompt = "\n".join(m["content"] for m in body["messages"])
        for keyword, reply in self.replies:
            if keyword in prompt:
                return sse(reply(body) if callable(reply) else reply)
        return sse("ok")


@pytest.fixture
def fake_llm():
    fake = FakeLLM()
    with respx.mock(assert_all_called=False) as router:
        router.post(f"{LLM_URL}/chat/completions").mock(side_effect=fake)
        router.get(f"{LLM_URL}/models").mock(return_value=httpx.Response(200, json={"data": [{"id": "m1"}, {"id": "m2"}]}))
        fake.router = router
        yield fake


def configure_llm(model: str = "m1") -> None:
    from app import settings_store

    settings_store.save({
        "connections": {"c1": {"preset": "custom", "name": "Test", "kind": "openai", "base_url": LLM_URL, "api_key": "sk-test"}},
        "roles": {role: {"connection": "c1", "model": model} for role in ("chat", "studio", "video")},
    })


def configure_voice(preset: str = "10labs", project: str = "homl") -> None:
    from app import settings_store

    settings_store.save({"voice": {"preset": preset, "kind": "elevenlabs", "base_url": VOICE_URL, "api_key": "tl_live_x",
                                   "model_id": "", "project": project, "host_a": "va", "host_b": "vb", "narrator": "vn"}})
