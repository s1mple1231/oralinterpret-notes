# Web Two-Stage Architecture Spec v1

## 1. Goal

This spec defines a web deployment architecture for realtime interpreter-style notes using a single model provider with two distinct stages:

- stage 1: realtime speech recognition
- stage 2: interpreter-style note generation

The system is designed for browser use, low-latency updates, and controllable note style.

## 2. Why Two Stages

Do not use a single black-box call for both speech understanding and note generation in v1.

Use two stages because:

- ASR and note generation optimize for different things
- transcript visibility is important for debugging and trust
- note style needs separate prompting and iteration
- revision handling is easier when transcript exists as an intermediate state
- product evaluation is clearer when "heard wrong" and "noted wrong" are separated

## 3. Core Architecture

```text
Browser
-> microphone capture
-> audio chunk upload

Backend
-> provider realtime ASR session
-> transcript chunk state
-> provider text generation call
-> note line state

Backend
-> SSE or WebSocket
-> Browser UI
```

Preferred v1 transport:

- browser to backend: `fetch` or `WebSocket`
- backend to provider ASR: provider realtime channel
- backend to browser updates: `SSE`

## 4. High-Level Components

### Frontend

Responsibilities:

- request microphone permission
- capture mono audio
- chunk audio and send to backend
- render transcript stream
- render note stream
- show session status
- allow start/stop

Should not:

- store provider API key
- call provider realtime endpoints directly in production
- embed note prompt logic in the browser

### Backend

Responsibilities:

- hold provider credentials
- create and manage ASR session
- normalize transcript events
- accumulate chunk/turn state
- call note generation model
- apply revision policy
- stream transcript and notes back to browser

Should also:

- expose a health endpoint
- log provider errors
- isolate one user session from another

### Provider ASR

Responsibilities:

- receive streaming audio
- return transcript deltas and final turns

### Provider Text Model

Responsibilities:

- convert transcript chunks into interpreter-style notes
- obey output schema
- preserve note style and revision behavior

## 5. Canonical Data Flow

### Step 1: session start

1. Browser calls backend `POST /api/session/start`
2. Backend creates provider ASR session
3. Backend returns session-ready status
4. Browser begins microphone capture

### Step 2: audio streaming

1. Browser captures audio frames
2. Browser downsamples to provider-required format if needed
3. Browser sends chunks to backend every 200-500 ms
4. Backend forwards chunks into provider ASR session

### Step 3: transcript updates

1. Provider sends transcript deltas
2. Backend appends deltas to current turn item
3. Backend pushes draft transcript to frontend
4. When provider marks a turn complete, backend stores a stable transcript item

### Step 4: note generation

1. Backend schedules draft note generation for active transcript chunk
2. Backend calls provider text model with:
   - current transcript chunk
   - recent stable notes context
   - note prompt package
   - JSON schema
3. Backend stores draft or stable note lines
4. Backend pushes notes to frontend

### Step 5: revision

1. If final transcript differs materially from draft text
2. Backend regenerates notes for that item
3. Backend marks changed lines as revised
4. Frontend updates only affected visual block

## 6. Session Model

Each browser session should maintain:

- one active ASR connection
- ordered transcript items
- ordered note groups
- recent stable context window
- pending note-generation timers
- line id counter
- session config

Recommended session config:

```json
{
  "language": "zh",
  "note_mode": "mixed",
  "speaker_mode": "single",
  "draft_delay_ms": 900,
  "audio_flush_ms": 300
}
```

## 7. Transcript State Model

Recommended transcript item shape:

```json
{
  "itemId": "item_12",
  "order": 12,
  "delta": "目前我们认为",
  "final": "目前我们认为这个方案在短期内可行，但成本仍然偏高。",
  "status": "stable"
}
```

Allowed `status`:

- `draft`
- `stable`

Rules:

- `delta` is mutable
- `final` is authoritative when available
- order must remain stable after assignment

## 8. Notes State Model

Recommended note group shape:

```json
{
  "itemId": "item_12",
  "status": "stable",
  "lines": [
    {
      "id": "line_34",
      "text": "short-term: feasible",
      "indent": 0,
      "semantic_type": "claim",
      "status": "stable",
      "revision_of": null
    },
    {
      "id": "line_35",
      "text": "but cost still high",
      "indent": 0,
      "semantic_type": "contrast",
      "status": "stable",
      "revision_of": null
    }
  ]
}
```

Notes should be grouped by transcript item, not only by time.

## 9. API Surface

Recommended minimal backend endpoints:

- `GET /api/health`
- `GET /api/events`
- `POST /api/session/start`
- `POST /api/session/audio`
- `POST /api/session/stop`

Optional later:

- `POST /api/session/config`
- `GET /api/session/export`
- `POST /api/session/glossary`

## 10. Browser-to-Backend Audio Policy

Recommended v1 audio behavior:

- mono audio only
- target 24 kHz PCM if provider accepts it
- flush every 200-500 ms
- do not wait for sentence boundaries in browser

Why:

- shorter chunks reduce perceived latency
- backend/provider should own turn segmentation

## 11. ASR-to-Notes Scheduling Policy

V1 scheduling recommendation:

- schedule draft notes after 700-1200 ms of silence in transcript delta updates
- immediately regenerate stable notes when transcript turn completes
- suppress parallel note generation for the same item

This avoids:

- excessive model calls
- flicker
- unstable notes from every tiny delta

## 12. Revision Policy

The system must support transcript-driven note revision.

Revision rules:

- do not revise notes on every delta
- revise when final transcript changes meaning, not punctuation only
- preserve unchanged lines when possible
- assign new line ids for revised lines
- set `revision_of` to the replaced line id

Good revision example:

```text
draft:
tariff maybe cut

final transcript shows:
tariff maybe hike

revised note:
tariff maybe hike
revision_of = old line id
```

## 13. Frontend Rendering Rules

UI should render two synchronized panes:

- transcript pane
- notes pane

Rendering guidance:

- latest items appear at bottom
- draft items have dashed or lighter styling
- notes use monospace or note-like compact font treatment
- revised lines should update in place, not rerender the whole list if possible

Important:

- keep transcript visible for trust
- keep notes visually scannable
- avoid paragraph layout in notes pane

## 14. Prompting Boundary

Do not make the frontend decide note style.

Prompting should stay server-side because:

- it is product logic
- it changes often
- you may want provider-specific prompts
- it should not be exposed as editable browser source in v1

Server-side assets should include:

- note spec
- prompt package
- output schema
- glossary mappings

## 15. Provider Constraint Strategy

This architecture assumes one provider can do both:

- realtime ASR
- text generation

But not necessarily in one API call.

Recommended provider usage pattern:

- provider capability A: realtime ASR endpoint
- provider capability B: text generation endpoint

This is still considered "single provider" architecture.

## 16. Recommended V1 Refresh Rhythm

Suggested timings:

- audio flush: `300 ms`
- draft note trigger: `900 ms`
- final note generation: immediate on final transcript
- UI event push: as soon as backend state changes

Expected user-visible behavior:

- transcript appears first
- draft note follows shortly
- final note replaces draft after turn stabilization

## 17. Error Handling

Backend should emit structured status events for:

- ASR connection opened
- ASR connection closed
- note generation failed
- provider rate limit
- invalid audio payload
- missing credentials

Frontend should show:

- human-readable status line
- whether system is listening
- whether provider is connected
- whether note generation is delayed

## 18. Security Rules

Production rules:

- do not expose provider secret in browser
- authenticate browser requests if public deployment
- rate-limit session creation
- isolate user sessions
- avoid logging raw sensitive audio unless explicitly enabled

For internal demo:

- a lightweight backend proxy is acceptable
- keep logs minimal

## 19. Deployment Shapes

### Shape A: local backend + browser

Best for:

- personal testing
- fast iteration

Pros:

- easiest to build
- low deployment overhead

Cons:

- not shareable by link

### Shape B: public web frontend + cloud backend

Best for:

- shareable demo
- multi-device access

Pros:

- real product shape

Cons:

- requires session isolation and auth

## 20. Cost Control Rules

Even with one provider, use two-stage cost controls:

- debounce draft note generation
- keep context window short
- only send recent stable notes, not full transcript history
- do not regenerate old items unless final transcript materially changed

Recommended v1 context window:

- last 8-12 stable note lines

## 21. Why This Fits Interpreter Notes

This architecture is well suited to interpreter-style notes because:

- transcript and notes can evolve independently
- note style can be iterated without touching ASR
- glossary injection is easy
- line-level revision is possible
- bilingual or mixed shorthand mode can be added later

## 22. V1 Acceptance Criteria

The architecture is good enough for v1 if:

- browser microphone to transcript latency feels near real time
- notes appear within 1-3 seconds after meaningful speech
- notes follow interpreter-style compression rather than summary prose
- final notes visibly improve over draft notes
- transcript and notes remain aligned by item

## 23. Recommended Next Implementation Step

After adopting this architecture, implement in this order:

1. stable browser capture + backend ASR loop
2. transcript event normalization
3. note generation with schema validation
4. draft/final revision flow
5. glossary and abbreviation config

## 24. Decision

For a web product that uses a single provider, v1 should use:

- one provider
- two capabilities
- two stages
- one visible transcript stream
- one visible notes stream

This is the best tradeoff between simplicity, controllability, and product realism.
