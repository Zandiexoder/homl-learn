# Homl Learn

A self-hosted research notebook in the spirit of NotebookLM. Add sources, chat with them with citations, and turn them into study material, a two-host podcast you can talk back to, and an animated explainer video. Everything is stored on your server. Language models and voices can be local or any cloud provider.

## What it does

| Area | Features |
|---|---|
| **Sources** | PDF, Word, Markdown/text, web pages, YouTube (transcripts), audio and video files (transcribed with speakers). Web discovery through SearXNG. Pick which sources each answer uses. |
| **Chat** | Answers grounded in your sources, with numbered citations that open the quoted passage. Notebook summary and suggested questions. Ask by voice. Save answers as notes. Configure each notebook's chat: default, learning guide, analyst or your own instructions, and shorter or longer answers. |
| **Studio** | Study guide, briefing doc, FAQ, custom reports, timeline with cast of characters, mind map (ask the chat about any topic in it), flashcards and quizzes. Outputs use a default language you set in Settings, or one you pick per output. |
| **Audio Overview** | Two hosts discuss your sources: deep dive, brief, critique or debate, three lengths, any language, a voice of your choice for each host. **Join the conversation**: interrupt, ask a question out loud, hear the hosts answer, then carry on. |
| **Video Overview** | The LLM follows the bundled [video-creation skill](backend/app/video/SKILL.md) to write a script and scene plan. A Remotion scene kit (14 animated scene types) draws it, and the LLM may write its own animated scenes, which are type-checked and sandboxed. Narration is voiced and the video gets subtitles, chapters and loudness normalisation, then is checked automatically (10 checks). Edit any line and re-voice just that line, or redraw one scene. |

## Providers

- **Language models**: presets for Anthropic, OpenAI, Google Gemini, Mistral, Groq, DeepSeek, xAI, OpenRouter, Together, Fireworks and Cerebras, plus local Ollama, LM Studio, vLLM and llama.cpp, or any custom OpenAI-compatible endpoint. Choose a different model for chat, Studio and video.
- **Voice**: any **ElevenLabs-compatible** API. Presets: **10labs** (your self-hosted server, with project selection, async jobs and clone status), **ElevenLabs**, **Kokoro** (local) and OpenAI TTS, or a custom endpoint of either protocol. Voice cloning works with 10labs and ElevenLabs.
- **Speech to text**: the voice provider (10labs, ElevenLabs, OpenAI), or local faster-whisper through Speaches.
- **Embeddings** (optional): keyword search works out of the box; add bge-m3 in Ollama or any OpenAI-compatible embeddings endpoint for meaning-based search.

API keys are encrypted at rest and never sent back to the browser.

## Run it

Requirements: Docker with Compose. An NVIDIA GPU (with the NVIDIA Container Toolkit) is needed only for the optional local model containers.

```bash
git clone <this repo> homl-learn && cd homl-learn
docker compose up -d --build
```

Open http://localhost:8000, set a password, then open **Settings**:

1. **Language models**: pick a preset, paste the key (or the URL of your local server), press **List** to choose a model, **Test**, then **Save connection**.
2. **Voice**: pick a provider, enter its URL and key, press **Save and load voices**, then choose voices for Host A, Host B and the video narrator.

### Using 10labs

Pick the **10labs** preset and enter your server's URL (for example `https://voice.example.com`) and a key (`tl_live_…`). Optionally type the **project** slug: every clip and transcript Homl Learn creates is filed under that project (without one, the key's default project is used). Leave **Model** blank to use the server's default, or enter one of the models from `GET /v1/models?kind=tts` such as `chatterbox` or `xtts-v2`; for multilingual models set **Language code**. Speech to text can use the same server ("Same as voice provider"); long recordings use 10labs' async transcription.

### Optional local engines

Each is a Compose profile; add the ones you want:

```bash
docker compose --profile local-llm --profile local-voice --profile local-stt --profile search up -d
```

| Profile | Service | Settings to use |
|---|---|---|
| `local-llm` | Ollama (GPU) | LLM preset **Ollama** (`http://ollama:11434/v1`). Pull models first: `docker compose exec ollama ollama pull qwen3:32b` and, for embeddings, `ollama pull bge-m3`. |
| `local-voice` | Kokoro (GPU) | Voice preset **Kokoro** (`http://kokoro:8880/v1`). |
| `local-stt` | Speaches / faster-whisper (GPU) | Speech-to-text preset **faster-whisper** (`http://stt:8000/v1`). |
| `search` | SearXNG | Search URL `http://searxng:8080`. Change `secret_key` in `deploy/searxng/settings.yml`. |

### Configuration

Environment variables (set them in a `.env` file next to `docker-compose.yml`):

| Variable | Default | Purpose |
|---|---|---|
| `HOML_PORT` | `8000` | Port on the host. |
| `APP_PASSWORD` | empty | Fix the password here instead of setting it in the browser. |
| `SECRET_KEY` | generated into `/data` | Encrypts stored API keys and signs sessions. Back it up with the data. |
| `COOKIE_SECURE` | `false` | Set `true` when serving over HTTPS. |
| `RENDER_CONCURRENCY` | Remotion default | Browser tabs used to render video frames. |
| `REMOTION_GL` | empty | `angle` or `egl` to try GPU rendering in the renderer container. |

All data (SQLite database, sources, audio, video) lives in the `homl-data` volume. To back up, copy that volume. To reach the app from other devices, put it behind a reverse proxy with HTTPS (Caddy, Traefik, nginx) and set `COOKIE_SECURE=true`.

### Video rendering and safety

The renderer container runs headless Chromium and executes scene code written by the language model. It sits on an internal Docker network with no internet access, accepts only job folders inside `/data`, and rejects code that imports anything besides `react`, `remotion` and the scene kit or that uses network, storage or dynamic-code APIs. A scene that fails to compile is replaced by a kit scene, and the failure is shown in the video studio. Set **Custom scenes per video** to 0 in Settings to use only the kit.

Rendering is CPU-bound. In testing, a 50-second video with 16 scenes took about 2 minutes to render with 4 browser tabs, so budget roughly two to three times the video's length unless you raise `RENDER_CONCURRENCY` on a bigger machine.

## Development

CI (`.github/workflows/ci.yml`) runs the backend tests, builds the frontend, type-checks and test-renders the scene kit, and builds both Docker images.


```bash
# backend
cd backend && uv venv && uv pip install -e '.[dev]'
DATA_DIR=./data .venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/pytest

# frontend (proxies /api to :8000)
cd frontend && npm install && npm run dev

# renderer
cd renderer && npm install
DATA_DIR=$PWD/../backend/data node server.mjs        # RENDERER_URL=http://localhost:3100 for the backend
DATA_DIR=/tmp/r node test/render-sample.mjs          # renders every kit scene
```

`backend/tests/fake_providers.py` is a fake LLM plus a fake 10labs-compatible voice server for trying the whole app without keys: run `uvicorn tests.fake_providers:app --port 9100` from `backend/`, then use `http://localhost:9100/v1` as a Custom LLM and `http://localhost:9100` as the 10labs server.

## Layout

```
backend/    FastAPI app: API, ingestion, retrieval, chat, Studio, podcast, video pipeline
  app/video/SKILL.md   the video-creation skill the LLM follows (adapted)
  app/video/KIT.md     scene kit catalogue given to the LLM
frontend/   React + Vite web app
renderer/   Remotion scene kit and render service
docs/SPEC.md  product decisions
```
