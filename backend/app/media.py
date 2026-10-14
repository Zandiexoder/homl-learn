"""ffmpeg helpers: durations, joining clips with gaps, loudness normalisation."""

from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path


class MediaError(RuntimeError):
    pass


async def run(*args: str) -> bytes:
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    out, err = await proc.communicate()
    if proc.returncode != 0:
        raise MediaError(f"{args[0]} failed: {err.decode(errors='replace')[-600:]}")
    return out


async def duration(path: Path) -> float:
    out = await run("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path))
    return float(json.loads(out)["format"]["duration"])


async def probe(path: Path) -> dict:
    out = await run("ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path))
    return json.loads(out)


async def to_wav(src: Path, dst: Path, rate: int = 24000) -> None:
    await run("ffmpeg", "-y", "-v", "error", "-i", str(src), "-ac", "1", "-ar", str(rate), str(dst))


async def join_clips(clips: list[Path], gaps: list[float], out_path: Path, *, tail: float = 0.5) -> list[float]:
    """Join clips with a silence after each (gaps[i] after clip i), normalise to -16 LUFS, write MP3.

    Returns the start time in seconds of each clip in the joined file.
    """
    if not clips:
        raise MediaError("Nothing to join.")
    starts: list[float] = []
    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        listing, t = [], 0.0
        silence_cache: dict[float, Path] = {}
        for i, clip in enumerate(clips):
            wav = tmp / f"c{i}.wav"
            await to_wav(clip, wav)
            starts.append(round(t, 3))
            t += await duration(wav)
            listing.append(wav)
            gap = round(gaps[i] if i < len(gaps) else 0.0, 2)
            if i == len(clips) - 1:
                gap = tail
            if gap > 0:
                if gap not in silence_cache:
                    sil = tmp / f"s{len(silence_cache)}.wav"
                    await run("ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
                              "anullsrc=r=24000:cl=mono", "-t", str(gap), str(sil))
                    silence_cache[gap] = sil
                listing.append(silence_cache[gap])
                t += gap
        concat = tmp / "list.txt"
        concat.write_text("".join(f"file '{p}'\n" for p in listing))
        joined = tmp / "joined.wav"
        await run("ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(concat),
                  "-c", "copy", str(joined))
        out_path.parent.mkdir(parents=True, exist_ok=True)
        await run("ffmpeg", "-y", "-v", "error", "-i", str(joined), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
                  "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k", str(out_path))
    return starts


RATE = 24000


async def decode_pcm(path: Path, rate: int = RATE):
    """Mono float32 samples of any audio file."""
    import numpy as np

    raw = await run("ffmpeg", "-v", "error", "-i", str(path), "-f", "s16le", "-ac", "1", "-ar", str(rate), "pipe:1")
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


async def place_clips(clips: list[Path], starts: list[float], total: float, out_path: Path) -> None:
    """Mix clips at exact start times (seconds) into one track of the given length, normalised to -16 LUFS.

    Unlike join_clips, placement is sample-exact, so narration stays locked to video frames.
    """
    import wave

    import numpy as np

    track = np.zeros(int(round(total * RATE)) + 1, dtype=np.float32)
    for clip, start in zip(clips, starts):
        pcm = await decode_pcm(clip)
        at = int(round(start * RATE))
        end = min(len(track), at + len(pcm))
        if end > at:
            track[at:end] += pcm[: end - at]
    np.clip(track, -1, 1, out=track)
    with tempfile.TemporaryDirectory() as tmp:
        wav_path = Path(tmp) / "track.wav"
        with wave.open(str(wav_path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes((track * 32767).astype(np.int16).tobytes())
        out_path.parent.mkdir(parents=True, exist_ok=True)
        await run("ffmpeg", "-y", "-v", "error", "-i", str(wav_path), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
                  "-ar", "48000", "-c:a", "aac", "-b:a", "192k", str(out_path))


async def loudness(path: Path) -> float | None:
    """Integrated loudness in LUFS."""
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-v", "info", "-nostats", "-i", str(path), "-af", "ebur128", "-f", "null", "-",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    _, err = await proc.communicate()
    text = err.decode(errors="replace")
    marker = text.rfind("Integrated loudness:")
    if marker < 0:
        return None
    for line in text[marker:].splitlines():
        line = line.strip()
        if line.startswith("I:"):
            return float(line.split()[1])
    return None
