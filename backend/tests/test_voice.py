import json

import httpx
import respx

from app import voice
from tests.conftest import VOICE_URL, configure_voice


async def test_10labs_tts_sends_key_and_project(tmp_path, mp3_bytes):
    configure_voice()
    with respx.mock() as router:
        route = router.post(f"{VOICE_URL}/v1/text-to-speech/va").mock(return_value=httpx.Response(200, content=mp3_bytes))
        out = await voice.synthesize("Hello there.", "va", tmp_path / "a.mp3")
    req = route.calls.last.request
    assert req.headers["xi-api-key"] == "tl_live_x"
    assert req.headers["X-Project"] == "homl"
    assert req.url.params["output_format"] == "mp3_44100_128"
    assert json.loads(req.content) == {"text": "Hello there."}
    assert out.read_bytes() == mp3_bytes


async def test_busy_server_is_retried_after_retry_after(tmp_path, mp3_bytes, monkeypatch):
    configure_voice()
    sleeps = []

    async def fake_sleep(s):
        sleeps.append(s)

    monkeypatch.setattr(voice.asyncio, "sleep", fake_sleep)
    with respx.mock() as router:
        router.post(f"{VOICE_URL}/v1/text-to-speech/va").mock(side_effect=[
            httpx.Response(429, headers={"Retry-After": "3"}, json={"detail": "busy"}),
            httpx.Response(200, content=mp3_bytes),
        ])
        await voice.synthesize("Hi.", "va", tmp_path / "a.mp3")
    assert sleeps == [3.0]


async def test_archived_project_error_is_explained(tmp_path):
    configure_voice()
    with respx.mock() as router:
        router.post(f"{VOICE_URL}/v1/text-to-speech/va").mock(return_value=httpx.Response(409, json={"detail": "Project is archived"}))
        try:
            await voice.synthesize("Hi.", "va", tmp_path / "a.mp3")
        except voice.VoiceError as exc:
            assert "archived" in str(exc)
        else:
            raise AssertionError("expected VoiceError")


async def test_clone_polls_until_ready(monkeypatch):
    configure_voice()

    async def no_sleep(_):
        return None

    monkeypatch.setattr(voice.asyncio, "sleep", no_sleep)
    with respx.mock() as router:
        add = router.post(f"{VOICE_URL}/v1/voices/add").mock(return_value=httpx.Response(200, json={"voice_id": "v9", "status": "processing"}))
        router.get(f"{VOICE_URL}/v1/voices/v9").mock(side_effect=[
            httpx.Response(200, json={"voice_id": "v9", "status": "processing"}),
            httpx.Response(200, json={"voice_id": "v9", "status": "ready"}),
        ])
        result = await voice.clone_voice("Me", [("me.wav", b"RIFF", "audio/wav")])
    assert result == {"id": "v9", "name": "Me", "status": "ready"}
    assert b'name="remove_background_noise"' in add.calls.last.request.content


async def test_long_transcription_uses_10labs_async(tmp_path, monkeypatch):
    configure_voice()

    async def no_sleep(_):
        return None

    monkeypatch.setattr(voice.asyncio, "sleep", no_sleep)
    audio = tmp_path / "lecture.m4a"
    audio.write_bytes(b"fake")
    with respx.mock() as router:
        router.post(f"{VOICE_URL}/v1/speech-to-text/async").mock(return_value=httpx.Response(200, json={"transcript_id": "t1"}))
        router.get(f"{VOICE_URL}/v1/transcripts/t1").mock(side_effect=[
            httpx.Response(200, json={"status": "processing"}),
            httpx.Response(200, json={"status": "done", "text": "hello class",
                                      "segments": [{"start": 0, "end": 1.2, "text": "hello class", "speaker": "speaker_0"}]}),
        ])
        result = await voice.transcribe(audio, diarize=True, long_form=True)
    assert result["text"] == "hello class"
    assert result["segments"][0]["speaker"] == "speaker_0"


async def test_elevenlabs_words_are_grouped_into_segments(tmp_path):
    configure_voice(preset="elevenlabs", project="")
    audio = tmp_path / "q.webm"
    audio.write_bytes(b"x")
    words = [{"text": "Why", "start": 0, "end": 0.2, "type": "word", "speaker_id": "s0"},
             {"text": " ", "type": "spacing"},
             {"text": "though?", "start": 0.2, "end": 0.5, "type": "word", "speaker_id": "s0"}]
    with respx.mock() as router:
        route = router.post(f"{VOICE_URL}/v1/speech-to-text").mock(return_value=httpx.Response(200, json={"text": "Why though?", "words": words}))
        result = await voice.transcribe(audio)
    assert "X-Project" not in route.calls.last.request.headers
    assert result["segments"] == [{"start": 0, "end": 0.5, "text": "Why though?", "speaker": "s0"}]


async def test_list_voices_and_projects():
    configure_voice()
    with respx.mock() as router:
        router.get(f"{VOICE_URL}/v1/voices").mock(return_value=httpx.Response(200, json={"voices": [
            {"voice_id": "a1", "name": "Aria", "category": "premade", "labels": {"accent": "british"}}]}))
        router.get(f"{VOICE_URL}/v1/projects").mock(return_value=httpx.Response(200, json=[{"slug": "homl", "name": "Homl"}]))
        voices = await voice.list_voices()
        projects = await voice.list_projects()
    assert voices[0]["id"] == "a1" and "british" in voices[0]["detail"]
    assert projects == [{"id": "homl", "name": "Homl"}]
