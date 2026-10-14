# Homl Learn: product spec (v1)

A self-hosted, single-user clone of NotebookLM. All data stays on the server; models and voices can be local or external.

## Decisions

| Area | Decision |
|---|---|
| Deployment | Self-hosted server, Docker Compose, single user behind one password |
| Hardware target | NVIDIA GPU (local LLM, TTS, STT, NVENC video encode) |
| Stack | FastAPI (Python) backend, React + Vite frontend, Remotion for video |
| Storage | Local only: SQLite + local vector index + files under `/data` |
| UI | Three panes (Sources, Chat, Studio) with its own identity ("homl learn") |

## Features (all in v1)

- **Sources**: PDF, web URL, YouTube, pasted text/Markdown, audio (transcribed). Web source discovery. Per-source selection for chat and generation.
- **Cited chat**: answers grounded in the selected sources with inline citation chips that open the quoted passage. Save answers to notes.
- **Studio outputs**: study guide, briefing doc, FAQ, timeline, mind map, flashcards, quiz, reports, notes.
- **Audio Overview**: two-host conversation, with a voice picked for each host. Formats: deep dive, brief, critique, debate. **Interactive mode** lets you interrupt and ask by voice (speech-to-text, then the LLM, then TTS).
- **Video Overview**: the LLM follows the bundled `video-creation/SKILL.md` (flat-vector explainer style) to write the script and one Remotion scene per beat. The pipeline is brief, script, narration, scene code, render, verify. Individual lines can be edited, re-voiced or redrawn.

## Providers

- **LLM**: any provider via presets (OpenAI, Anthropic, Google Gemini, Mistral, Groq, DeepSeek, xAI, OpenRouter, Together, Ollama, LM Studio, vLLM) plus a custom OpenAI-compatible endpoint. A model can be assigned per task (chat, studio/podcast script, video script). Local embeddings (bge-m3).
- **Voice**: any **ElevenLabs-compatible** TTS API. Presets: 10labs (self-hosted: projects via `X-Project`, async transcription, clone status polling; its chatterbox, F5-TTS and XTTS models cover local cloning), ElevenLabs (cloud), Kokoro (local, OpenAI-compatible), OpenAI TTS, or a custom endpoint of either protocol. Voice cloning from an uploaded sample.
- **Speech-to-text**: the voice provider (10labs, ElevenLabs, OpenAI), faster-whisper via Speaches (local), or any OpenAI-compatible transcription endpoint.

## Design

Canvas with the four v1 screens (home, notebook workspace, settings, video studio):
https://claude.ai/artifact/W4opiF46y7KWXyzAgBHAwe

Look: cool green-grey ground `#EEF1EC`, ink `#15201B`, green accent `#0B6E55` (chat and video), amber `#B4560B` (audio). Type: Bricolage Grotesque (display), IBM Plex Sans (body), IBM Plex Mono (metadata).
