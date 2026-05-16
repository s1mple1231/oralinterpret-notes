# Backend Deploy Notes

## Goal

This document describes the simplest way to deploy the Node backend for the interpreting notes demo.

It assumes:

- frontend is deployed separately
- backend is a long-running Node service
- demo mode may use `mock + mock`
- real providers can be enabled later with environment variables

## Recommended Hosts

Good first options:

- Railway
- Render

These are suitable because the backend needs:

- persistent Node runtime
- outbound WebSocket support
- SSE streaming
- environment variable management

## Backend Entry Point

The backend entry point is:

- `server.js`

The root `package.json` already contains:

- `npm start`

So most hosts can use:

```text
Build command: npm install
Start command: npm start
```

## Required Files

For backend deployment, the important files are:

- `server.js`
- `package.json`
- `interpreting-notes-prompt-v1.md`
- `interpreting-notes-schema-v1.json`
- `.env.deploy.example`

The `public/` folder is optional for a split deployment because the React frontend will live separately, but keeping it does not hurt.

## Minimum Demo Environment

For a public demo without real model keys, use:

```env
PORT=3000
SESSION_TTL_MS=1800000
ALLOWED_ORIGINS=https://your-frontend-domain.vercel.app

ASR_PROVIDER=mock
NOTES_PROVIDER=mock
TRANSCRIPTION_LANGUAGE=zh
```

This is the easiest safe path for a first shareable link.

## Later Real-Provider Environment

When you want to switch to Qwen later:

```env
PORT=3000
SESSION_TTL_MS=1800000
ALLOWED_ORIGINS=https://your-frontend-domain.vercel.app

ASR_PROVIDER=qwen
NOTES_PROVIDER=qwen
TRANSCRIPTION_LANGUAGE=zh

QWEN_API_KEY=your_key
QWEN_ASR_MODEL=qwen3-asr-flash-realtime
QWEN_ASR_BASE_URL=wss://dashscope.aliyuncs.com/api-ws/v1/realtime
QWEN_MODEL=qwen-plus
```

## Railway Setup

### Create Service

1. Create a new project in Railway
2. Connect the GitHub repository
3. Select the repo root as the deploy source

### Commands

Use:

```text
Install command: npm install
Start command: npm start
```

### Variables

Add the environment variables from the demo or Qwen config above.

### Domain

1. Generate a Railway domain
2. Copy the backend URL
3. Put that URL into the frontend config as `VITE_API_BASE_URL`

## Render Setup

### Create Service

1. Create a new Web Service
2. Connect the GitHub repository
3. Use the repo root

### Runtime

Choose:

- Node

### Commands

Use:

```text
Build command: npm install
Start command: npm start
```

### Variables

Add the same environment variables as above.

### Health Check

Use:

```text
/api/health
```

## Frontend Connection

The frontend Vite app uses:

- `VITE_API_BASE_URL`

Set it to your backend URL, for example:

```env
VITE_API_BASE_URL=https://your-backend-domain.up.railway.app
```

## CORS

The backend reads:

- `ALLOWED_ORIGINS`

Set it to the exact frontend origin, for example:

```env
ALLOWED_ORIGINS=https://your-frontend-domain.vercel.app
```

If you later use a custom domain, update this value too.

## Smoke Test After Deploy

After the backend is live:

1. Open `https://your-backend-domain/.../api/health`
2. Confirm `ok: true`
3. Confirm provider defaults are what you expect
4. Confirm the frontend can load and start a session

## Recommended First Public Rollout

The smoothest rollout order is:

1. deploy backend in `mock + mock`
2. deploy frontend to Vercel
3. verify end-to-end session start
4. share the demo link
5. switch to real providers later

This minimizes risk and keeps deployment separate from model integration.
