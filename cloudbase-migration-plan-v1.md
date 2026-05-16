# CloudBase Migration Plan v1

## Goal

This document describes how to migrate the current backend from in-memory session state to a CloudBase-friendly persistence model.

## Current Status

The codebase now has:

- polling-based frontend state sync
- serializable session snapshots
- a store boundary in the backend
- `SESSION_STORE=memory` working today
- `SESSION_STORE=cloudbase` wired to a real store skeleton

Relevant backend pieces:

- session snapshot functions in `server.js`
- `InMemorySessionStore`
- `cloudbase-session-store.js`
- `createSessionStore()`

## Target Shape

The CloudBase-ready store should support:

- create session
- get session by id
- save updated session snapshot
- delete session
- optional list and cleanup

The runtime session object can still exist in memory temporarily, but the source of truth should become a persisted snapshot.

## Suggested Storage Model

Recommended collection:

- `interpreting_sessions`

Suggested document shape:

```json
{
  "_id": "session-id",
  "createdAt": 1710000000000,
  "lastSeenAt": 1710000001000,
  "asrReady": false,
  "asrProviderName": "mock",
  "notesProviderName": "mock",
  "sessionConfig": {
    "language": "zh"
  },
  "itemOrder": ["item_1", "item_2"],
  "lineCounter": 12,
  "itemCounter": 2,
  "transcript": [],
  "notes": []
}
```

## Migration Steps

### Step 1

Keep `SESSION_STORE=memory` as the default local mode.

### Step 2

Complete the `CloudBaseSessionStore` integration by:

- writes `createSessionSnapshot(session)`
- restores with `restoreSessionFromSnapshot(snapshot)`
- installs and configures the official CloudBase Node SDK

### Step 3

Set:

- `SESSION_STORE=cloudbase`
- `CLOUDBASE_ENV_ID`
- optional `CLOUDBASE_COLLECTION`

Then install the CloudBase SDK in the backend runtime.

### Step 4

Move cleanup logic from in-memory iteration to document TTL or scheduled cleanup.

## Practical Strategy

The safest rollout is:

1. local mock mode
2. deployed mock mode
3. real CloudBase store with mock providers
4. real provider integration

This keeps deployment risk separate from provider risk.
