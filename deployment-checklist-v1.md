# Deployment Checklist v1

## Goal

This checklist defines the minimum deployment shape for the web version of the realtime interpreting notes prototype.

It assumes:

- browser frontend
- Node backend
- realtime audio upload
- SSE updates
- no public API keys in the browser

It does not require real model credentials yet.

## Recommended Shape

Use a split deployment:

- frontend: EdgeOne Pages static web app
- backend: CloudBase Run long-running Node service

Do not deploy the whole app as static hosting only.

Do not rely on pure serverless functions for the realtime session loop in v1.

## Why Split Frontend and Backend

The frontend is lightweight and easy to host statically.

The backend needs:

- long-lived process memory
- session state
- SSE connections
- realtime provider sockets

These are better served by a persistent Node runtime.

## Frontend Requirements

The frontend host must support:

- HTTPS
- browser microphone access
- static file hosting

Recommended option for this repo:

- EdgeOne Pages

## Backend Requirements

The backend host must support:

- persistent Node process
- outbound WebSocket connections
- SSE responses
- environment variables

Recommended option for this repo:

- CloudBase Run

## Minimum Production Topology

```text
Browser
-> Frontend host
-> Backend API origin
-> ASR provider
-> Notes provider
```

Recommended frontend config:

- frontend and backend can be on different domains
- frontend calls backend over HTTPS

Example:

- frontend: `https://notes-demo.example.com`
- backend: `https://notes-api.example.com`

## API Surface To Expose

The backend should expose:

- `GET /`
- `GET /app.js`
- `GET /styles.css`
- `GET /api/health`
- `GET /api/providers`
- `GET /api/events`
- `POST /api/session/start`
- `POST /api/session/audio`
- `POST /api/session/stop`

## Pre-Deployment Checklist

Before deployment, confirm:

- `node --check server.js` passes
- `node --check public/app.js` passes
- `npm install` succeeds
- `GET /api/health` returns JSON
- frontend loads without console syntax errors

## Environment Variables

Use separate env files for local and deployment.

Suggested groups:

- runtime
- provider selection
- provider secrets
- session tuning

Core variables:

- `PORT`
- `ASR_PROVIDER`
- `NOTES_PROVIDER`
- `TRANSCRIPTION_LANGUAGE`
- `SESSION_TTL_MS`
- `ALLOWED_ORIGINS`

Provider variables:

- `QWEN_API_KEY`
- `QWEN_ASR_MODEL`
- `QWEN_ASR_BASE_URL`
- `QWEN_MODEL`
- `OPENAI_API_KEY`
- `OPENAI_NOTES_MODEL`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_MODEL`

## Security Baseline

Before public deployment:

- do not expose provider keys to the browser
- do not trust a client-sent provider name without backend validation
- add session rate limits
- add request size limits
- add basic origin restrictions

Strongly recommended next:

- add auth or private access gate
- add server logs with secret redaction

## Session Isolation Rules

The backend must keep each browser session isolated by:

- separate `sessionId`
- separate transcript state
- separate notes state
- separate SSE subscriptions
- separate ASR connection

This is already the correct architecture for deployment.

## Cross-Origin Policy

If frontend and backend use different origins, configure:

- CORS for `POST /api/session/*`
- SSE access for `GET /api/events`

Recommended rule for v1:

- allow only the known frontend origin

Do not use wildcard CORS in public deployment.

## Health Checks

The backend should expose a machine-readable health endpoint.

Current expectation:

- `GET /api/health`

Should include:

- app ok flag
- provider catalog
- session summary
- startup checks

This is useful for:

- platform health probes
- manual debugging
- deployment verification

## Logging Policy

For v1 deployment:

- log startup checks
- log provider connection failures
- log session lifecycle
- avoid logging raw audio data
- avoid logging full secrets

Optional:

- log transcript length only
- log note generation latency

## Frontend Deployment Steps

1. Upload or build the static frontend files
2. Set `public/config.js` so `apiBaseUrl` points to the backend origin
3. Confirm HTTPS is enabled
4. Confirm browser microphone permission works on the deployed domain

If using the new React frontend:

1. deploy `frontend/` to EdgeOne Pages
2. set `VITE_API_BASE_URL`
3. point it to the CloudBase HTTP access domain

## Backend Deployment Steps

1. Create a CloudBase environment
2. Create a CloudBase Run service for the repo root backend
3. Set environment variables
4. Install dependencies with `npm install`
5. Run `node server.js`
6. Expose the service through CloudBase HTTP access service
7. Confirm `GET /api/health` succeeds
8. Confirm the EdgeOne frontend can reach the backend

## Reverse Proxy Notes

If you place a reverse proxy in front of the backend:

- keep SSE buffering disabled
- allow long-lived connections
- allow request bodies large enough for audio chunk posts

## What Not To Add Yet

Do not block deployment by adding:

- database persistence
- user accounts
- billing
- note export
- analytics
- diarization

These can wait until the realtime loop is stable.

## Mock-First Deployment Mode

If you want deployment without real providers yet:

- keep the same backend shape
- swap in mock providers later
- still deploy frontend and backend separately

This is a good rehearsal for the real deployment path.

## Recommended Next Step

Before integrating real provider credentials, the best next move is:

1. add a deploy env template
2. add optional frontend API base config
3. add CORS handling in the backend

That will make the app structurally ready for public hosting.

This prototype now includes:

- `ALLOWED_ORIGINS` for backend CORS allowlist
- polling-based frontend state sync for a CloudBase-friendlier runtime
- `cloudbase-session-store.js` for the CloudBase persistence path
