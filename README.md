# Realtime Interpreting Notes Prototype

This is a prototype for realtime interpreter-style notes with switchable provider adapters and deploy-friendly session isolation.

## What it does

- captures microphone audio in the browser
- streams mono PCM chunks to a local Node server
- forwards audio to a pluggable ASR provider
- receives transcript deltas and final turns
- converts each chunk into interpreter-style notes through a pluggable notes provider
- renders transcript and notes side by side
- isolates each browser connection with its own backend session

## Files

- `server.js`: local server, provider adapters, SSE event fan-out
- `frontend/`: shadcn-style React frontend based on the official shadcn/ui Vite setup pattern
- `public/index.html`: UI shell
- `public/app.js`: microphone capture, audio chunking, realtime UI updates
- `public/config.js`: frontend API base config
- `public/config.example.js`: example config for split frontend/backend deploy
- `public/styles.css`: UI styling
- `deployment-checklist-v1.md`: deployment structure and rollout checklist
- `backend-deploy-notes.md`: backend deployment notes for Railway / Render
- `cloudbase-migration-plan-v1.md`: roadmap for moving session state into CloudBase persistence
- `.env.deploy.example`: deploy-time environment template
- `interpreting-notes-spec-v1.md`: output spec
- `interpreting-notes-prompt-v1.md`: note-generation prompt package
- `interpreting-notes-schema-v1.json`: structured note schema

## Run

1. Create a local `.env` file from `.env.example`, or export variables in your shell:

```powershell
$env:OPENAI_API_KEY="YOUR_KEY"
$env:QWEN_API_KEY="YOUR_KEY"
$env:ASR_PROVIDER="qwen"
$env:NOTES_PROVIDER="qwen"
$env:OPENAI_NOTES_MODEL="gpt-5.4-mini"
$env:TRANSCRIPTION_LANGUAGE="zh"
```

2. Start the server:

```powershell
npm install
node server.js
```

3. Open:

```text
http://localhost:3000
```

## Current limitations

- lightweight multi-session support exists, but there is no auth yet
- ASR adapters are implemented for `openai` and `qwen`
- notes adapters can switch between `openai`, `qwen`, and `deepseek` using OpenAI-compatible chat completion endpoints
- notes adapters can switch between `openai`, `qwen`, `deepseek`, and `modelscope` using OpenAI-compatible chat completion endpoints
- transcript ordering is best-effort
- draft notes are regenerated per chunk rather than true line-level patching
- browser audio capture uses `ScriptProcessorNode`, which is fine for a prototype but not ideal for production
- no glossary injection UI yet
- no diarization yet

## Good next steps

- add real session auth before public internet exposure
- replace `ScriptProcessorNode` with `AudioWorklet`
- persist session state and notes history
- add glossary and abbreviation presets
- support line-level note revision instead of whole-item replacement
- add optional bilingual display

## Qwen-first quick test

If you want the all-Qwen two-stage path first:

```env
ASR_PROVIDER=qwen
NOTES_PROVIDER=qwen
QWEN_API_KEY=your_bailian_key
QWEN_ASR_MODEL=qwen3-asr-flash-realtime
QWEN_MODEL=qwen-plus
TRANSCRIPTION_LANGUAGE=zh
```

Then run:

```powershell
npm install
node server.js
```

The health endpoint now exposes startup checks:

```text
http://localhost:3000/api/health
```

## Deployment Prep

If you want to prepare for web deployment before adding real keys:

- read `deployment-checklist-v1.md`
- copy `.env.deploy.example` when setting up the backend host
- keep frontend and backend as separate deploy targets
- set `public/config.js` so `apiBaseUrl` points at the backend if frontend and backend use different origins

## New React Frontend

There is now a separate frontend app in `frontend/` built in the style of the official `shadcn/ui` Vite setup.

Recommended frontend run flow:

1. Go to `frontend/`
2. Copy `.env.example` to `.env`
3. Set `VITE_API_BASE_URL`
4. Install dependencies
5. Run the Vite dev server

Example:

```powershell
cd frontend
copy .env.example .env
npm install
npm run dev
```

Example `frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:3000
```

## Deploy Targets

Recommended split:

- frontend: EdgeOne Pages using `frontend/`
- backend: CloudBase Run plus CloudBase HTTP access service using the repo root

Why this split:

- EdgeOne is a better fit for the public web frontend and CDN-style delivery
- CloudBase Run is a better fit for the current Node backend shape with polling, audio upload, and session state

Suggested production path:

1. deploy `frontend/` to EdgeOne Pages
2. deploy the repo root backend to CloudBase Run
3. expose the backend through CloudBase HTTP access service
4. point `VITE_API_BASE_URL` at the CloudBase backend domain
5. move `SESSION_STORE` from `memory` to `cloudbase` when ready

Useful files:

- `deployment-checklist-v1.md`
- `cloudbase-migration-plan-v1.md`
- `edgeone-cloudbase-deploy-plan-v1.md`
- `Dockerfile`

## ModelScope Notes Quick Test

If you want to test free ModelScope API-Inference on the notes layer first:

```env
ASR_PROVIDER=mock
NOTES_PROVIDER=modelscope
MODELSCOPE_API_KEY=your_modelscope_token
MODELSCOPE_BASE_URL=https://api-inference.modelscope.cn/v1
MODELSCOPE_MODEL=Qwen/Qwen3-32B
TRANSCRIPTION_LANGUAGE=zh
```

This keeps ASR in mock mode and swaps only the note generation layer, which is the safest first integration path.
