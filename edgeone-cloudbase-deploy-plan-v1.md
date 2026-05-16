# EdgeOne + CloudBase Deploy Plan v1

## Goal

This document defines the recommended deployment shape for this project after choosing:

- frontend: EdgeOne Pages
- backend: CloudBase Run

## Recommended Topology

```text
Browser
-> EdgeOne Pages frontend
-> CloudBase HTTP access service
-> CloudBase Run backend
-> optional CloudBase database-backed session store
```

## Why This Is The Best Fit

The current frontend is a static Vite app and is easy to publish on EdgeOne Pages.

The current backend is still a Node HTTP server with:

- audio upload endpoints
- polling-based session state reads
- provider adapters
- session lifecycle logic

That shape maps better to CloudBase Run than to edge functions or pure static hosting.

## Frontend Target

Deploy:

- `frontend/`

Set frontend environment variables:

- `VITE_API_BASE_URL=https://your-cloudbase-api-domain`

## Backend Target

Deploy:

- repo root

Run mode:

- Node long-running service inside CloudBase Run

Backend env baseline:

```env
PORT=3000
SESSION_TTL_MS=1800000
SESSION_STORE=memory
CLOUDBASE_ENV_ID=your-env-id
CLOUDBASE_COLLECTION=interpreting_sessions
ALLOWED_ORIGINS=https://your-edgeone-domain

ASR_PROVIDER=mock
NOTES_PROVIDER=mock
TRANSCRIPTION_LANGUAGE=zh
```

## Rollout Order

### Phase 1

Deploy with:

- `ASR_PROVIDER=mock`
- `NOTES_PROVIDER=mock`
- `SESSION_STORE=memory`

This verifies:

- EdgeOne frontend access
- CloudBase backend reachability
- CORS
- audio upload path
- state polling path

### Phase 2

Keep mock providers, then switch:

- `SESSION_STORE=cloudbase`

This verifies:

- session persistence
- snapshot restore
- CloudBase store wiring

### Phase 3

After storage is stable, enable real providers.

Recommended order:

1. real notes provider
2. real ASR provider

## What To Configure In CloudBase

Create or confirm:

- one CloudBase environment
- one CloudBase Run service for the backend
- one HTTP access service route for the backend
- one database collection:
  `interpreting_sessions`

## What To Configure In EdgeOne

Create:

- one EdgeOne Pages project pointing to `frontend/`

Set:

- frontend build command
- frontend output directory
- `VITE_API_BASE_URL`

## Current Repo Files To Use

- `frontend/`
- `server.js`
- `cloudbase-session-store.js`
- `.env.deploy.example`
- `cloudbase-migration-plan-v1.md`

## Notes

The current backend is closest to CloudBase Run, not CloudBase Functions.

If you later want a more serverless backend shape, that should be a second-stage refactor instead of the first deployment target.
