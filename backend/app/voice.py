"""Text to speech, voice cloning and speech to text.

Two protocols:
  * ElevenLabs-compatible (`kind="elevenlabs"`): ElevenLabs itself, 10labs, or any server with the same
    API. 10labs extras are supported: the `X-Project` header, async jobs for long transcriptions, and
    clone status polling.
  * OpenAI-compatible (`kind="openai"`): /audio/speech and /audio/transcriptions (Kokoro-FastAPI,
    Speaches/faster-whisper, OpenAI).
"""

from __future__ import annotations

import asyncio
import re
import tempfile
from pathlib import Path

import httpx

from . import media, settings_store
from .presets import voice_preset

TTS_CHAR_LIMIT = 4500  # 10labs and ElevenLabs accept 5,000 characters per request
POLL_SECONDS = 2.0


class VoiceError(RuntimeError):
    pass


def _el_base(cfg: dict) -> str:
    base = (cfg.get("base_url") or "").rstrip("/")
    if not base:
        raise VoiceError("Set the voice server URL in Settings.")
    return base[:-3] if base.endswith("/v1") else base


def _el_headers(cfg: dict) -> dict[str, str]:
    headers: dict[str, str] = {}
    if cfg.get("api_key"):
        headers["xi-api-key"] = cfg["api_key"]
    if cfg.get("project"):
        headers["X-Project"] = cfg["project"]
    return headers


def _oa_headers(cfg: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {cfg['api_key']}"} if cfg.get("api_key") else {}


def _detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
        detail = body.get("detail", body.get("error", body))
        if isinstance(detail, dict):
            detail = detail.get("message", detail)
        return str(detail)[:300]
    except ValueError:
        return resp.text[:300]


async def _request(client: httpx.AsyncClient, method: str, url: str, **kwargs) -> httpx.Response:
    """HTTP call that waits out 429 'busy' replies using Retry-After."""
    for attempt in range(6):
        resp = await client.request(method, url, **kwargs)
        if resp.status_code != 429:
            break
        wait = float(resp.headers.get("Retry-After", 2 * (attempt + 1)))
        await asyncio.sleep(min(wait, 30))
    if resp.status_code >= 400:
        hints = {401: "the API key was rejected", 403: "the key lacks permission",
                 404: "not found (check the URL or project)", 409: "conflict (is the project archived?)"}
        hint = hints.get(resp.status_code, "")
        raise VoiceError(f"Voice server returned {resp.status_code}{': ' + hint if hint else ''}. {_detail(resp)}")
    return resp


def split_for_tts(text: str, limit: int = TTS_CHAR_LIMIT) -> list[str]:
    text = text.strip()
    if len(text) <= limit:
        return [text]
    parts, current = [], ""
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        while len(sentence) > limit:
            parts.append(sentence[:limit])
            sentence = sentence[limit:]
        if len(current) + len(sentence) + 1 > limit and current:
            parts.append(current)
            current = ""
        current = f"{current} {sentence}".strip()
    if current:
        parts.append(current)
    return parts


def voice_config() -> dict:
    return settings_store.load()["voice"]


async def _tts_once(cfg: dict, text: str, voice_id: str, speed: float | None) -> bytes:
    async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=15)) as client:
        if cfg["kind"] == "elevenlabs":
            body: dict = {"text": text}
            if cfg.get("model_id"):
                body["model_id"] = cfg["model_id"]
            if cfg.get("language_code"):
                body["language_code"] = cfg["language_code"]
            if speed:
                body["voice_settings"] = {"speed": speed}
            resp = await _request(
                client, "POST", f"{_el_base(cfg)}/v1/text-to-speech/{voice_id}",
                params={"output_format": "mp3_44100_128"}, headers=_el_headers(cfg), json=body,
            )
        else:
            body = {"model": cfg.get("model_id") or "tts-1", "input": text, "voice": voice_id,
                    "response_format": "mp3"}
            if speed:
                body["speed"] = speed
            resp = await _request(client, "POST", cfg["base_url"].rstrip("/") + "/audio/speech",
                                  headers=_oa_headers(cfg), json=body)
    return resp.content


async def synthesize(text: str, voice_id: str, out_path: Path, *, speed: float | None = None,
                     cfg: dict | None = None) -> Path:
    """Speak text with a voice and write an MP3. Long text is split and joined."""
    cfg = cfg or voice_config()
    if not voice_id:
        raise VoiceError("Pick a voice in Settings.")
    parts = split_for_tts(text)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if len(parts) == 1:
        out_path.write_bytes(await _tts_once(cfg, parts[0], voice_id, speed))
        return out_path
    with tempfile.TemporaryDirectory() as tmp:
        clips = []
        for i, part in enumerate(parts):
            clip = Path(tmp) / f"p{i}.mp3"
            clip.write_bytes(await _tts_once(cfg, part, voice_id, speed))
            clips.append(clip)
        await media.join_clips(clips, [0.15] * len(clips), out_path, tail=0.0)
    return out_path


async def list_voices(cfg: dict | None = None) -> list[dict]:
    cfg = cfg or voice_config()
    async with httpx.AsyncClient(timeout=30) as client:
        if cfg["kind"] == "elevenlabs":
            resp = await _request(client, "GET", f"{_el_base(cfg)}/v1/voices", headers=_el_headers(cfg))
            out = []
            for v in resp.json().get("voices", []):
                labels = v.get("labels") or {}
                detail = ", ".join(str(x) for x in [v.get("category"), *labels.values()] if x)
                out.append({"id": v["voice_id"], "name": v.get("name", v["voice_id"]), "detail": detail,
                            "status": v.get("status", "ready")})
            return out
        preset = voice_preset(cfg.get("preset", ""))
        if preset.get("voices"):
            return [{"id": v, "name": v, "detail": ""} for v in preset["voices"]]
        try:
            resp = await _request(client, "GET", cfg["base_url"].rstrip("/") + "/audio/voices",
                                  headers=_oa_headers(cfg))
            voices = resp.json().get("voices", [])
            return [{"id": v if isinstance(v, str) else v.get("id", v.get("name")),
                     "name": v if isinstance(v, str) else v.get("name", v.get("id")), "detail": ""}
                    for v in voices]
        except (VoiceError, httpx.HTTPError):
            return []


async def list_projects(cfg: dict | None = None) -> list[dict]:
    """10labs projects the key can use."""
    cfg = cfg or voice_config()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await _request(client, "GET", f"{_el_base(cfg)}/v1/projects", headers=_el_headers(cfg))
    body = resp.json()
    items = body.get("projects", body) if isinstance(body, dict) else body
    return [{"id": p.get("slug") or p.get("id"), "name": p.get("name") or p.get("slug") or p.get("id")}
            for p in items if isinstance(p, dict)]


async def clone_voice(name: str, files: list[tuple[str, bytes, str]], *, description: str = "",
                      remove_background_noise: bool = True, cfg: dict | None = None) -> dict:
    cfg = cfg or voice_config()
    if cfg["kind"] != "elevenlabs":
        raise VoiceError("Voice cloning needs an ElevenLabs-compatible provider such as 10labs or ElevenLabs.")
    data = {"name": name, "remove_background_noise": str(remove_background_noise).lower()}
    if description:
        data["description"] = description
    async with httpx.AsyncClient(timeout=httpx.Timeout(600, connect=15)) as client:
        resp = await _request(
            client, "POST", f"{_el_base(cfg)}/v1/voices/add", headers=_el_headers(cfg), data=data,
            files=[("files", (fname, content, ctype)) for fname, content, ctype in files],
        )
        voice = resp.json()
        voice_id = voice["voice_id"]
        status = voice.get("status", "ready")
        # 10labs prepares cloned voices in the background; ElevenLabs returns them ready.
        for _ in range(300):
            if status != "processing":
                break
            await asyncio.sleep(POLL_SECONDS)
            check = await _request(client, "GET", f"{_el_base(cfg)}/v1/voices/{voice_id}",
                                   headers=_el_headers(cfg))
            status = check.json().get("status", "ready")
    if status not in ("ready", "processing"):
        raise VoiceError(f"Cloning failed (status: {status}).")
    return {"id": voice_id, "name": name, "status": status}


def stt_config() -> dict:
    """Resolve the speech-to-text settings, following 'same as voice provider'."""
    settings = settings_store.load()
    stt = dict(settings["stt"])
    if stt.get("kind") == "voice":
        v = settings["voice"]
        preset = voice_preset(v.get("preset", ""))
        if not preset.get("stt"):
            raise VoiceError(f"{preset['name']} can't transcribe. Choose a speech-to-text engine in Settings.")
        stt = {"kind": v["kind"], "base_url": v["base_url"], "api_key": v.get("api_key", ""),
               "model": preset.get("stt_model", ""), "project": v.get("project", ""),
               "preset": v.get("preset", "")}
    return stt


async def transcribe(path: Path, *, language: str | None = None, diarize: bool = False,
                     long_form: bool = False, cfg: dict | None = None) -> dict:
    """Returns {"text": str, "segments": [{"start", "end", "text", "speaker"}]}."""
    cfg = cfg or stt_config()
    content = path.read_bytes()
    filename = path.name
    async with httpx.AsyncClient(timeout=httpx.Timeout(1800, connect=15)) as client:
        if cfg["kind"] == "elevenlabs":
            data: dict = {}
            if cfg.get("model"):
                data["model_id"] = cfg["model"]
            if language:
                data["language_code"] = language
            if diarize:
                data["diarize"] = "true"
            base, headers = _el_base(cfg), _el_headers(cfg)
            if long_form and cfg.get("preset") == "10labs":
                resp = await _request(client, "POST", f"{base}/v1/speech-to-text/async", headers=headers,
                                      data=data, files={"file": (filename, content)})
                transcript_id = resp.json()["transcript_id"]
                while True:
                    await asyncio.sleep(POLL_SECONDS)
                    resp = await _request(client, "GET", f"{base}/v1/transcripts/{transcript_id}",
                                          headers=headers)
                    body = resp.json()
                    if body.get("status") == "done":
                        break
                    if body.get("status") in ("failed", "error"):
                        raise VoiceError(f"Transcription failed: {body.get('error', 'unknown error')}")
            else:
                resp = await _request(client, "POST", f"{base}/v1/speech-to-text", headers=headers,
                                      data=data, files={"file": (filename, content)})
                body = resp.json()
            return _normalise_transcript(body)
        data = {"model": cfg.get("model") or "whisper-1", "response_format": "verbose_json"}
        if language:
            data["language"] = language
        resp = await _request(client, "POST", cfg["base_url"].rstrip("/") + "/audio/transcriptions",
                              headers=_oa_headers(cfg), data=data, files={"file": (filename, content)})
        return _normalise_transcript(resp.json())


def _normalise_transcript(body: dict) -> dict:
    segments = []
    for seg in body.get("segments") or []:
        segments.append({"start": seg.get("start"), "end": seg.get("end"),
                         "text": (seg.get("text") or "").strip(), "speaker": seg.get("speaker") or seg.get("speaker_id")})
    if not segments and body.get("words"):
        # ElevenLabs shape: group words into sentence-ish segments by speaker.
        current: dict | None = None
        for w in body["words"]:
            if w.get("type") == "spacing":
                continue
            speaker = w.get("speaker_id")
            if current is None or speaker != current["speaker"] or current["text"].endswith((".", "?", "!")):
                if current:
                    segments.append(current)
                current = {"start": w.get("start"), "end": w.get("end"), "text": "", "speaker": speaker}
            current["text"] = f"{current['text']} {w.get('text', '').strip()}".strip()
            current["end"] = w.get("end")
        if current:
            segments.append(current)
    text = (body.get("text") or " ".join(s["text"] for s in segments)).strip()
    return {"text": text, "segments": segments, "language": body.get("language_code") or body.get("language")}
