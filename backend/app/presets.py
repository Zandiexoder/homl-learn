"""Provider presets shown in Settings. A preset only pre-fills fields; every field stays editable.

`kind` picks the wire protocol:
  LLM:        "openai" (OpenAI-compatible /chat/completions) or "anthropic" (Messages API)
  voice/STT:  "elevenlabs" (ElevenLabs-compatible API) or "openai" (/audio/speech, /audio/transcriptions)
  embeddings: "keyword" (built-in, no model) or "openai" (/embeddings)
Default models are suggestions; the Settings page can list a provider's models live.
"""

LLM_PRESETS: list[dict] = [
    {"id": "anthropic", "name": "Anthropic", "kind": "anthropic", "location": "cloud",
     "base_url": "https://api.anthropic.com", "model": "claude-opus-5-5", "needs_key": True},
    {"id": "openai", "name": "OpenAI", "kind": "openai", "location": "cloud",
     "base_url": "https://api.openai.com/v1", "model": "", "needs_key": True},
    {"id": "gemini", "name": "Google Gemini", "kind": "openai", "location": "cloud",
     "base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "model": "", "needs_key": True},
    {"id": "mistral", "name": "Mistral", "kind": "openai", "location": "cloud",
     "base_url": "https://api.mistral.ai/v1", "model": "mistral-large-latest", "needs_key": True},
    {"id": "groq", "name": "Groq", "kind": "openai", "location": "cloud",
     "base_url": "https://api.groq.com/openai/v1", "model": "", "needs_key": True},
    {"id": "deepseek", "name": "DeepSeek", "kind": "openai", "location": "cloud",
     "base_url": "https://api.deepseek.com/v1", "model": "deepseek-chat", "needs_key": True},
    {"id": "xai", "name": "xAI", "kind": "openai", "location": "cloud",
     "base_url": "https://api.x.ai/v1", "model": "", "needs_key": True},
    {"id": "openrouter", "name": "OpenRouter", "kind": "openai", "location": "cloud",
     "base_url": "https://openrouter.ai/api/v1", "model": "", "needs_key": True},
    {"id": "together", "name": "Together", "kind": "openai", "location": "cloud",
     "base_url": "https://api.together.xyz/v1", "model": "", "needs_key": True},
    {"id": "fireworks", "name": "Fireworks", "kind": "openai", "location": "cloud",
     "base_url": "https://api.fireworks.ai/inference/v1", "model": "", "needs_key": True},
    {"id": "cerebras", "name": "Cerebras", "kind": "openai", "location": "cloud",
     "base_url": "https://api.cerebras.ai/v1", "model": "", "needs_key": True},
    {"id": "ollama", "name": "Ollama", "kind": "openai", "location": "local",
     "base_url": "http://ollama:11434/v1", "model": "qwen3:32b", "needs_key": False},
    {"id": "lmstudio", "name": "LM Studio", "kind": "openai", "location": "local",
     "base_url": "http://host.docker.internal:1234/v1", "model": "", "needs_key": False},
    {"id": "vllm", "name": "vLLM", "kind": "openai", "location": "local",
     "base_url": "http://vllm:8000/v1", "model": "", "needs_key": False},
    {"id": "llamacpp", "name": "llama.cpp server", "kind": "openai", "location": "local",
     "base_url": "http://llamacpp:8080/v1", "model": "", "needs_key": False},
    {"id": "custom", "name": "Custom", "kind": "openai", "location": "OpenAI-compatible",
     "base_url": "", "model": "", "needs_key": False},
]

VOICE_PRESETS: list[dict] = [
    {"id": "10labs", "name": "10labs", "kind": "elevenlabs", "location": "self-hosted",
     "base_url": "", "model_id": "", "needs_key": True, "cloning": True, "projects": True,
     "async_jobs": True, "stt": True,
     "note": "Your self-hosted 10labs server. Pick a project to file clips and transcripts under."},
    {"id": "elevenlabs", "name": "ElevenLabs", "kind": "elevenlabs", "location": "cloud",
     "base_url": "https://api.elevenlabs.io", "model_id": "eleven_multilingual_v2",
     "needs_key": True, "cloning": True, "projects": False, "async_jobs": False, "stt": True,
     "stt_model": "scribe_v1"},
    {"id": "kokoro", "name": "Kokoro", "kind": "openai", "location": "local",
     "base_url": "http://kokoro:8880/v1", "model_id": "kokoro", "needs_key": False,
     "cloning": False, "projects": False, "async_jobs": False, "stt": False},
    {"id": "openai-tts", "name": "OpenAI TTS", "kind": "openai", "location": "cloud",
     "base_url": "https://api.openai.com/v1", "model_id": "gpt-4o-mini-tts", "needs_key": True,
     "cloning": False, "projects": False, "async_jobs": False, "stt": True, "stt_model": "whisper-1",
     "voices": ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"]},
    {"id": "custom-elevenlabs", "name": "Custom", "kind": "elevenlabs",
     "location": "ElevenLabs-compatible", "base_url": "", "model_id": "", "needs_key": False,
     "cloning": True, "projects": False, "async_jobs": False, "stt": True},
    {"id": "custom-openai", "name": "Custom", "kind": "openai", "location": "OpenAI-compatible",
     "base_url": "", "model_id": "", "needs_key": False, "cloning": False, "projects": False,
     "async_jobs": False, "stt": True},
]

STT_PRESETS: list[dict] = [
    {"id": "voice", "name": "Same as voice provider", "kind": "voice", "location": "",
     "base_url": "", "model": ""},
    {"id": "faster-whisper", "name": "faster-whisper (Speaches)", "kind": "openai", "location": "local",
     "base_url": "http://stt:8000/v1", "model": "Systran/faster-whisper-large-v3"},
    {"id": "10labs", "name": "10labs", "kind": "elevenlabs", "location": "self-hosted",
     "base_url": "", "model": ""},
    {"id": "elevenlabs", "name": "ElevenLabs Scribe", "kind": "elevenlabs", "location": "cloud",
     "base_url": "https://api.elevenlabs.io", "model": "scribe_v1"},
    {"id": "openai", "name": "OpenAI", "kind": "openai", "location": "cloud",
     "base_url": "https://api.openai.com/v1", "model": "whisper-1"},
    {"id": "custom", "name": "Custom", "kind": "openai", "location": "OpenAI-compatible",
     "base_url": "", "model": ""},
]

EMBEDDING_PRESETS: list[dict] = [
    {"id": "keyword", "name": "Keyword search (built in)", "kind": "keyword", "location": "local",
     "base_url": "", "model": ""},
    {"id": "ollama", "name": "Ollama bge-m3", "kind": "openai", "location": "local",
     "base_url": "http://ollama:11434/v1", "model": "bge-m3"},
    {"id": "openai", "name": "OpenAI", "kind": "openai", "location": "cloud",
     "base_url": "https://api.openai.com/v1", "model": "text-embedding-3-small"},
    {"id": "custom", "name": "Custom", "kind": "openai", "location": "OpenAI-compatible",
     "base_url": "", "model": ""},
]


def all_presets() -> dict:
    return {
        "llm": LLM_PRESETS,
        "voice": VOICE_PRESETS,
        "stt": STT_PRESETS,
        "embeddings": EMBEDDING_PRESETS,
    }


def voice_preset(preset_id: str) -> dict:
    return next((p for p in VOICE_PRESETS if p["id"] == preset_id), VOICE_PRESETS[-2])
