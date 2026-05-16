import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import NodeWebSocket from "ws";
import { CloudBaseSessionStore } from "./cloudbase-session-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  const envText = await readFile(path.join(__dirname, ".env"), "utf8");
  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
} catch {
  // Ignore missing .env for local prototype usage.
}

const PORT = Number(process.env.PORT || 3000);
const DEFAULT_LANGUAGE = process.env.TRANSCRIPTION_LANGUAGE || "zh";
const DEFAULT_ASR_PROVIDER = process.env.ASR_PROVIDER || "openai";
const DEFAULT_NOTES_PROVIDER = process.env.NOTES_PROVIDER || "openai";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 30 * 60 * 1000);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const CLOUDBASE_ENV_ID = process.env.CLOUDBASE_ENV_ID || "";
const CLOUDBASE_COLLECTION = process.env.CLOUDBASE_COLLECTION || "interpreting_sessions";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2";
const OPENAI_TRANSCRIPTION_MODEL =
  process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-realtime-whisper";
const NOTES_MODEL = process.env.NOTES_MODEL || "gpt-5.4-mini";

const OPENAI_NOTES_API_KEY = process.env.OPENAI_NOTES_API_KEY || OPENAI_API_KEY;
const QWEN_API_KEY = process.env.QWEN_API_KEY || "";
const QWEN_ASR_MODEL = process.env.QWEN_ASR_MODEL || "qwen3-asr-flash-realtime";
const QWEN_ASR_BASE_URL =
  process.env.QWEN_ASR_BASE_URL || "wss://dashscope.aliyuncs.com/api-ws/v1/realtime";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";

const providerCatalog = {
  asr: {
    mock: {
      label: "Mock ASR",
      kind: "realtime_asr",
      implemented: true,
      sampleRate: 16000,
      inputAudioFormat: "pcm"
    },
    openai: {
      label: "OpenAI Realtime",
      kind: "realtime_asr",
      implemented: true,
      sampleRate: 24000,
      inputAudioFormat: "pcm"
    },
    qwen: {
      label: "Qwen Realtime ASR",
      kind: "realtime_asr",
      implemented: true,
      sampleRate: 16000,
      inputAudioFormat: "pcm"
    },
    doubao: {
      label: "Doubao Realtime Speech",
      kind: "realtime_asr",
      implemented: false
    }
  },
  notes: {
    mock: {
      label: "Mock Notes",
      kind: "text_generation",
      implemented: true
    },
    openai: {
      label: "OpenAI Notes",
      kind: "text_generation",
      implemented: true,
      baseUrl: process.env.OPENAI_NOTES_BASE_URL || "https://api.openai.com/v1",
      model: process.env.OPENAI_NOTES_MODEL || NOTES_MODEL,
      apiKey: OPENAI_NOTES_API_KEY
    },
    qwen: {
      label: "Qwen Notes",
      kind: "text_generation",
      implemented: true,
      baseUrl:
        process.env.QWEN_BASE_URL ||
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: process.env.QWEN_MODEL || "qwen-plus",
      apiKey: QWEN_API_KEY
    },
    deepseek: {
      label: "DeepSeek Notes",
      kind: "text_generation",
      implemented: true,
      baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      apiKey: DEEPSEEK_API_KEY
    }
  }
};

const promptDoc = await readFile(
  path.join(__dirname, "interpreting-notes-prompt-v1.md"),
  "utf8"
);
const outputSchema = JSON.parse(
  await readFile(
    path.join(__dirname, "interpreting-notes-schema-v1.json"),
    "utf8"
  )
);

const publicDir = path.join(__dirname, "public");

function getStartupChecks() {
  return [
    {
      key: "ws_dependency",
      ok: Boolean(NodeWebSocket),
      message: "The `ws` dependency is required for Qwen ASR."
    },
    {
      key: "qwen_api_key",
      ok: Boolean(QWEN_API_KEY),
      message: "QWEN_API_KEY is required for all-Qwen two-stage testing."
    },
    {
      key: "openai_api_key",
      ok: Boolean(OPENAI_API_KEY),
      message: "OPENAI_API_KEY is required only when using OpenAI ASR or OpenAI Notes."
    },
    {
      key: "session_store",
      ok: true,
      message: `Session store mode: ${process.env.SESSION_STORE || "memory"}`
    },
    {
      key: "cloudbase_env",
      ok: Boolean(CLOUDBASE_ENV_ID) || (process.env.SESSION_STORE || "memory") !== "cloudbase",
      message: "CLOUDBASE_ENV_ID is required when SESSION_STORE=cloudbase."
    }
  ];
}

function createSessionState() {
  return {
    id: randomUUID(),
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    asrSession: null,
    asrReady: false,
    asrProviderName: DEFAULT_ASR_PROVIDER,
    notesProviderName: DEFAULT_NOTES_PROVIDER,
    sseClients: new Set(),
    itemOrder: [],
    transcriptByItemId: new Map(),
    notesByItemId: new Map(),
    pendingDraftTimers: new Map(),
    generatingForItem: new Set(),
    sessionConfig: {
      language: DEFAULT_LANGUAGE
    },
    lineCounter: 0,
    itemCounter: 0
  };
}

class InMemorySessionStore {
  constructor() {
    this.sessions = new Map();
  }

  create() {
    const session = createSessionState();
    this.sessions.set(session.id, session);
    return session;
  }

  get(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  save(session) {
    this.sessions.set(session.id, session);
    return session;
  }

  delete(sessionId) {
    this.sessions.delete(sessionId);
  }

  values() {
    return this.sessions.values();
  }

  summary() {
    return {
      activeSessions: this.sessions.size,
      ttlMs: SESSION_TTL_MS,
      storageMode: "memory",
      snapshotReady: true
    };
  }
}

function createSessionStore() {
  const storeMode = String(process.env.SESSION_STORE || "memory").trim().toLowerCase();

  if (storeMode === "memory") {
    return new InMemorySessionStore();
  }

  if (storeMode === "cloudbase") {
    return new CloudBaseSessionStore({
      createSessionState,
      envId: CLOUDBASE_ENV_ID,
      collection: CLOUDBASE_COLLECTION,
      ttlMs: SESSION_TTL_MS,
      restoreSessionFromSnapshot,
      createSessionSnapshot
    });
  }

  throw new Error(`Unsupported SESSION_STORE value: ${storeMode}`);
}

const sessionStore = createSessionStore();

function json(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function getAllowedOrigin(origin) {
  if (!origin || !ALLOWED_ORIGINS.length) {
    return null;
  }

  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

function applyCors(req, res) {
  const allowedOrigin = getAllowedOrigin(req.headers.origin);
  if (!allowedOrigin) {
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function getProviderSummary(session) {
  return {
    active: {
      asr: session?.asrProviderName || DEFAULT_ASR_PROVIDER,
      notes: session?.notesProviderName || DEFAULT_NOTES_PROVIDER
    },
    catalog: {
      asr: Object.entries(providerCatalog.asr).map(([name, provider]) => ({
        name,
        label: provider.label,
        implemented: provider.implemented,
        sampleRate: provider.sampleRate || null
      })),
      notes: Object.entries(providerCatalog.notes).map(([name, provider]) => ({
        name,
        label: provider.label,
        implemented: provider.implemented,
        configured: provider.apiKey === undefined ? true : Boolean(provider.apiKey)
      }))
    }
  };
}

function buildHealthPayload() {
  return {
    ok: true,
    providers: getProviderSummary(),
    sessions: sessionStore.summary(),
    startupChecks: getStartupChecks()
  };
}

function touchSession(session) {
  session.lastSeenAt = Date.now();
}

async function persistSession(session) {
  await sessionStore.save(session);
}

function sendSessionEvent(session, payload) {
  touchSession(session);
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of session.sseClients) {
    client.write(data);
  }
}

function resetSessionItems(session) {
  for (const timer of session.pendingDraftTimers.values()) {
    clearTimeout(timer);
  }

  session.pendingDraftTimers.clear();
  session.itemOrder = [];
  session.transcriptByItemId.clear();
  session.notesByItemId.clear();
  session.generatingForItem.clear();
  session.lineCounter = 0;
  session.itemCounter = 0;
}

function stopAsrSession(session) {
  if (session.asrSession) {
    session.asrSession.stopSession();
    session.asrSession = null;
  }

  session.asrReady = false;
}

async function destroySession(session) {
  stopAsrSession(session);
  resetSessionItems(session);
  for (const client of session.sseClients) {
    client.end();
  }
  session.sseClients.clear();
  await sessionStore.delete(session.id);
}

function ensureItem(session, itemId) {
  if (!session.transcriptByItemId.has(itemId)) {
    session.itemCounter += 1;
    session.itemOrder.push(itemId);
    session.transcriptByItemId.set(itemId, {
      itemId,
      order: session.itemCounter,
      delta: "",
      final: "",
      status: "draft"
    });
  }

  return session.transcriptByItemId.get(itemId);
}

function noteContextText(session) {
  const orderedNotes = session.itemOrder
    .map((itemId) => session.notesByItemId.get(itemId))
    .filter(Boolean)
    .flatMap((entry) => entry.lines.map((line) => line.text));

  return orderedNotes.slice(-12).join("\n");
}

function orderedTranscriptItems(session) {
  return session.itemOrder.map((itemId) => session.transcriptByItemId.get(itemId));
}

function orderedNoteItems(session) {
  return session.itemOrder.map((itemId) => session.notesByItemId.get(itemId)).filter(Boolean);
}

function createSessionSnapshot(session) {
  return {
    id: session.id,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    asrReady: session.asrReady,
    asrProviderName: session.asrProviderName,
    notesProviderName: session.notesProviderName,
    sessionConfig: { ...session.sessionConfig },
    itemOrder: [...session.itemOrder],
    lineCounter: session.lineCounter,
    itemCounter: session.itemCounter,
    transcript: orderedTranscriptItems(session).map((item) => ({
      itemId: item.itemId,
      order: item.order,
      delta: item.delta,
      final: item.final,
      status: item.status
    })),
    notes: orderedNoteItems(session).map((item) => ({
      itemId: item.itemId,
      status: item.status,
      lines: item.lines.map((line) => ({
        id: line.id,
        text: line.text,
        status: line.status,
        indent: line.indent,
        semantic_type: line.semantic_type,
        speaker: line.speaker,
        revision_of: line.revision_of,
        itemId: line.itemId
      }))
    }))
  };
}

function restoreSessionFromSnapshot(snapshot) {
  const session = createSessionState();
  session.id = snapshot.id;
  session.createdAt = snapshot.createdAt;
  session.lastSeenAt = snapshot.lastSeenAt;
  session.asrReady = snapshot.asrReady;
  session.asrProviderName = snapshot.asrProviderName;
  session.notesProviderName = snapshot.notesProviderName;
  session.sessionConfig = { ...snapshot.sessionConfig };
  session.itemOrder = [...snapshot.itemOrder];
  session.lineCounter = snapshot.lineCounter;
  session.itemCounter = snapshot.itemCounter;

  for (const item of snapshot.transcript || []) {
    session.transcriptByItemId.set(item.itemId, {
      itemId: item.itemId,
      order: item.order,
      delta: item.delta,
      final: item.final,
      status: item.status
    });
  }

  for (const note of snapshot.notes || []) {
    session.notesByItemId.set(note.itemId, {
      itemId: note.itemId,
      status: note.status,
      lines: (note.lines || []).map((line) => ({
        id: line.id,
        text: line.text,
        status: line.status,
        indent: line.indent,
        semantic_type: line.semantic_type,
        speaker: line.speaker,
        revision_of: line.revision_of,
        itemId: line.itemId
      }))
    });
  }

  return session;
}

function normalizeLines(session, lines, status, itemId) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => {
      session.lineCounter += 1;
      return {
        id: `line_${session.lineCounter}`,
        text: String(line.text || "").trim(),
        status,
        indent: Number.isInteger(line.indent)
          ? Math.max(0, Math.min(2, line.indent))
          : 0,
        semantic_type: String(line.semantic_type || "claim"),
        speaker: line.speaker || "speaker_1",
        revision_of: line.revision_of || null,
        itemId
      };
    })
    .filter((line) => line.text);
}

function requireProviderConfig(group, name) {
  const provider = providerCatalog[group][name];
  if (!provider) {
    throw new Error(`Unknown ${group} provider: ${name}`);
  }

  if (!provider.implemented) {
    throw new Error(`${provider.label} adapter is not implemented yet.`);
  }

  if (provider.apiKey !== undefined && !provider.apiKey) {
    throw new Error(`${provider.label} is not configured. Add its API key to .env.`);
  }

  return provider;
}

async function callJsonApi(baseUrl, pathname, apiKey, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return payload;
}

class OpenAIRealtimeAsrProvider {
  constructor(config) {
    this.config = config;
    this.socket = null;
    this.ready = false;
  }

  startSession({ language, onEvent, onStatus }) {
    const protocols = ["realtime", `openai-insecure-api-key.${this.config.apiKey}`];

    this.socket = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${this.config.realtimeModel}`,
      protocols
    );

    this.socket.addEventListener("open", () => {
      this.ready = true;
      this.socket.send(
        JSON.stringify({
          type: "session.update",
          session: {
            type: "transcription",
            audio: {
              input: {
                format: {
                  type: "audio/pcm",
                  rate: 24000
                },
                noise_reduction: {
                  type: "near_field"
                },
                transcription: {
                  model: this.config.transcriptionModel,
                  language
                },
                turn_detection: {
                  type: "server_vad",
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 500
                }
              }
            },
            include: ["item.input_audio_transcription.logprobs"]
          }
        })
      );

      onStatus({
        type: "status",
        status: "connected",
        message: `${this.config.label} connected.`
      });
    });

    this.socket.addEventListener("message", async (event) => {
      try {
        const payload = JSON.parse(event.data);
        await onEvent(payload);
      } catch (error) {
        onStatus({
          type: "error",
          message: `Failed to process realtime event: ${error.message}`
        });
      }
    });

    this.socket.addEventListener("close", () => {
      this.ready = false;
      onStatus({
        type: "status",
        status: "disconnected",
        message: `${this.config.label} disconnected.`
      });
    });

    this.socket.addEventListener("error", () => {
      onStatus({
        type: "error",
        message: `${this.config.label} socket error. Check API key and model access.`
      });
    });
  }

  appendAudio(audio) {
    if (!this.socket || !this.ready) {
      throw new Error("Realtime ASR session is not connected yet.");
    }

    this.socket.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio
      })
    );
  }

  stopSession() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.ready = false;
  }
}

class QwenRealtimeAsrProvider {
  constructor(config) {
    this.config = config;
    this.socket = null;
    this.ready = false;
  }

  startSession({ language, onEvent, onStatus }) {
    const wsUrl = `${this.config.baseUrl}?model=${encodeURIComponent(this.config.model)}`;
    this.socket = new NodeWebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "OpenAI-Beta": "realtime=v1"
      }
    });

    this.socket.on("open", () => {
      this.ready = true;
      this.socket.send(
        JSON.stringify({
          event_id: `event_${Date.now()}`,
          type: "session.update",
          session: {
            modalities: ["text"],
            input_audio_format: this.config.inputAudioFormat,
            sample_rate: this.config.sampleRate,
            input_audio_transcription: {
              language
            },
            turn_detection: {
              type: "server_vad",
              threshold: 0.0,
              silence_duration_ms: 400
            }
          }
        })
      );

      onStatus({
        type: "status",
        status: "connected",
        message: `${this.config.label} connected.`
      });
    });

    this.socket.on("message", async (message) => {
      try {
        const payload = JSON.parse(String(message));
        await onEvent(payload);
      } catch (error) {
        onStatus({
          type: "error",
          message: `Failed to process qwen realtime event: ${error.message}`
        });
      }
    });

    this.socket.on("close", () => {
      this.ready = false;
      onStatus({
        type: "status",
        status: "disconnected",
        message: `${this.config.label} disconnected.`
      });
    });

    this.socket.on("error", (error) => {
      onStatus({
        type: "error",
        message: `${this.config.label} socket error: ${error.message}`
      });
    });
  }

  appendAudio(audio) {
    if (!this.socket || !this.ready) {
      throw new Error("Qwen ASR session is not connected yet.");
    }

    this.socket.send(
      JSON.stringify({
        event_id: `event_${Date.now()}`,
        type: "input_audio_buffer.append",
        audio
      })
    );
  }

  stopSession() {
    if (!this.socket) {
      return;
    }

    if (this.ready) {
      try {
        this.socket.send(
          JSON.stringify({
            event_id: `event_${Date.now()}`,
            type: "session.finish"
          })
        );
      } catch {
        // Ignore shutdown send errors.
      }
    }

    this.socket.close();
    this.socket = null;
    this.ready = false;
  }
}

class OpenAICompatibleNotesProvider {
  constructor(config) {
    this.config = config;
  }

  async generateNotes(payload) {
    const userPrompt = [
      "Use the following prompt package:",
      promptDoc,
      "",
      "Session config:",
      `- mode: mixed`,
      `- target_language_bias: mixed shorthand`,
      `- glossary: []`,
      `- custom_abbreviations: []`,
      `- preferred_symbols: [\"b/c\", \"->\", \"/\", \"?\", \"up\", \"down\"]`,
      "",
      "Task:",
      "Convert the following live transcript chunk into interpreter-style notes.",
      "",
      "Context from previous stable notes:",
      payload.contextText || "(none)",
      "",
      "Current transcript chunk:",
      payload.transcriptText,
      "",
      "Chunk metadata:",
      `- speaker: speaker_1`,
      `- time_range_ms: unknown`,
      `- partial_or_final: ${payload.status === "stable" ? "final" : "partial"}`,
      "",
      "Output JSON only."
    ].join("\n");

    const response = await callJsonApi(
      this.config.baseUrl,
      "/chat/completions",
      this.config.apiKey,
      {
        model: this.config.model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You generate interpreter-style notes. Return valid JSON only and obey the schema."
          },
          {
            role: "user",
            content: userPrompt
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "interpreting_notes_stream",
            strict: true,
            schema: outputSchema
          }
        }
      }
    );

    const content = response?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error(`${this.config.label} returned empty note content.`);
    }

    return JSON.parse(content);
  }
}

class MockAsrProvider {
  constructor(config) {
    this.config = config;
    this.onEvent = null;
    this.onStatus = null;
    this.ready = false;
    this.chunkCount = 0;
    this.itemIndex = 0;
    this.demoTimer = null;
    this.script = [
      {
        draft: [
          "today we review Q3 results",
          "revenue up but cost pressure remains"
        ],
        final:
          "Today we review Q3 results. Revenue is up, but cost pressure remains and margin recovery is still uncertain."
      },
      {
        draft: [
          "next focus = efficiency",
          "AI tools / delivery speed / hiring control"
        ],
        final:
          "The next focus is efficiency, including AI tools, delivery speed, and tighter hiring control."
      },
      {
        draft: [
          "risk:",
          "budget ? timeline ? team load ?"
        ],
        final:
          "The main risks are budget, timeline, and team workload."
      }
    ];
  }

  startSession({ onEvent, onStatus }) {
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.ready = true;
    onStatus({
      type: "status",
      status: "connected",
      message: `${this.config.label} connected. Demo transcript mode is active.`
    });

    this.demoTimer = setInterval(() => {
      try {
        this.appendAudio();
      } catch {
        // Ignore demo timer errors during shutdown races.
      }
    }, 1200);
  }

  appendAudio() {
    if (!this.ready) {
      throw new Error("Mock ASR session is not connected yet.");
    }

    this.chunkCount += 1;
    const active = this.script[this.itemIndex % this.script.length];
    const itemId = `mock_item_${this.itemIndex + 1}`;
    const draftIndex = Math.min(active.draft.length - 1, Math.floor((this.chunkCount - 1) / 3));
    const draftText = active.draft.slice(0, draftIndex + 1).join(" ");

    this.onEvent({
      type: "conversation.item.input_audio_transcription.text",
      item_id: itemId,
      text: draftText,
      stash: ""
    });

    if (this.chunkCount % 6 === 0) {
      this.onEvent({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: itemId,
        transcript: active.final
      });
      this.itemIndex += 1;
    }
  }

  stopSession() {
    if (this.demoTimer) {
      clearInterval(this.demoTimer);
      this.demoTimer = null;
    }

    if (this.ready && this.onStatus) {
      this.onStatus({
        type: "status",
        status: "disconnected",
        message: `${this.config.label} disconnected.`
      });
    }

    this.ready = false;
  }
}

class MockNotesProvider {
  async generateNotes(payload) {
    const text = String(payload.transcriptText || "").trim();
    const compact = text
      .replace(/[.，。,!?]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const tokens = compact.split(" ").filter(Boolean);
    const left = tokens.slice(0, 5).join(" ");
    const right = tokens.slice(5, 11).join(" ");

    const lines = [
      {
        text: left || "main point",
        indent: 0,
        semantic_type: "claim"
      }
    ];

    if (right) {
      lines.push({
        text: `-> ${right}`,
        indent: 0,
        semantic_type: "support"
      });
    }

    if (/risk|uncertain|pressure|budget|timeline|cost/i.test(compact)) {
      lines.push({
        text: "risk / pressure / ?",
        indent: 0,
        semantic_type: "question"
      });
    }

    return { lines };
  }
}

function createAsrProvider(name) {
  if (name !== "openai" && name !== "mock") {
    requireProviderConfig("asr", name);
  }

  const provider = requireProviderConfig("asr", name);
  if (name === "mock") {
    return new MockAsrProvider(provider);
  }

  if (name === "openai") {
    if (!OPENAI_API_KEY) {
      throw new Error("OpenAI Realtime is not configured. Add OPENAI_API_KEY to .env.");
    }

    return new OpenAIRealtimeAsrProvider({
      ...provider,
      apiKey: OPENAI_API_KEY,
      realtimeModel: OPENAI_REALTIME_MODEL,
      transcriptionModel: OPENAI_TRANSCRIPTION_MODEL
    });
  }

  if (name === "qwen") {
    if (!QWEN_API_KEY) {
      throw new Error("Qwen Realtime ASR is not configured. Add QWEN_API_KEY to .env.");
    }

    return new QwenRealtimeAsrProvider({
      ...provider,
      apiKey: QWEN_API_KEY,
      model: QWEN_ASR_MODEL,
      baseUrl: QWEN_ASR_BASE_URL
    });
  }

  throw new Error(`${provider.label} adapter is not implemented yet.`);
}

function createNotesProvider(name) {
  const provider = requireProviderConfig("notes", name);
  if (name === "mock") {
    return new MockNotesProvider();
  }

  return new OpenAICompatibleNotesProvider(provider);
}

async function handleRealtimeEvent(session, message) {
  if (
    message.type === "conversation.item.input_audio_transcription.delta" ||
    message.type === "conversation.item.input_audio_transcription.text"
  ) {
    const item = ensureItem(session, message.item_id);
    const chunk = message.delta || [message.text, message.stash].filter(Boolean).join("");
    item.delta += chunk || "";
    item.status = "draft";

    sendSessionEvent(session, {
      type: "transcript",
      itemId: item.itemId,
      status: "draft",
      text: item.delta
    });
    await persistSession(session);

    scheduleDraftNotes(session, item.itemId);
    return;
  }

  if (message.type === "conversation.item.input_audio_transcription.completed") {
    const item = ensureItem(session, message.item_id);
    item.final = message.transcript || item.delta;
    item.status = "stable";

    sendSessionEvent(session, {
      type: "transcript",
      itemId: item.itemId,
      status: "stable",
      text: item.final
    });
    await persistSession(session);

    await generateNotesForItem(session, item.itemId, "stable");
    return;
  }

  if (message.type === "error") {
    sendSessionEvent(session, {
      type: "error",
      message: message.error?.message || "Realtime ASR provider error."
    });
    return;
  }

  if (message.type === "session.finished") {
    sendSessionEvent(session, {
      type: "status",
      status: "disconnected",
      message: "ASR session finished."
    });
  }
}

function scheduleDraftNotes(session, itemId) {
  const existing = session.pendingDraftTimers.get(itemId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    session.pendingDraftTimers.delete(itemId);
    generateNotesForItem(session, itemId, "draft").catch((error) => {
      sendSessionEvent(session, { type: "error", message: error.message });
    });
  }, 900);

  session.pendingDraftTimers.set(itemId, timer);
}

async function generateNotesForItem(session, itemId, status) {
  if (session.generatingForItem.has(itemId)) {
    return;
  }

  const item = session.transcriptByItemId.get(itemId);
  if (!item) {
    return;
  }

  const transcriptText = status === "stable" ? item.final || item.delta : item.delta;
  if (!transcriptText.trim()) {
    return;
  }

  session.generatingForItem.add(itemId);

  try {
    const notesProvider = createNotesProvider(session.notesProviderName);
    const parsed = await notesProvider.generateNotes({
      transcriptText,
      contextText: noteContextText(session),
      status
    });

    const lines = normalizeLines(session, parsed.lines, status, itemId);
    session.notesByItemId.set(itemId, {
      itemId,
      status,
      lines
    });
    await persistSession(session);

    sendSessionEvent(session, {
      type: "notes",
      itemId,
      status,
      lines
    });
  } finally {
    session.generatingForItem.delete(itemId);
  }
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function serveFile(res, filepath, contentType) {
  const content = await readFile(filepath);
  res.writeHead(200, { "Content-Type": contentType });
  res.end(content);
}

function sessionBootstrapPayload(session) {
  return {
    type: "bootstrap",
    sessionId: session.id,
    asrReady: session.asrReady,
    audio: {
      sampleRate:
        providerCatalog.asr[session.asrProviderName]?.sampleRate ||
        providerCatalog.asr[DEFAULT_ASR_PROVIDER]?.sampleRate ||
        24000
    },
    providers: getProviderSummary(session),
    transcript: orderedTranscriptItems(session),
    notes: orderedNoteItems(session),
    snapshot: createSessionSnapshot(session)
  };
}

function sessionStatePayload(session) {
  return {
    ok: true,
    sessionId: session.id,
    asrReady: session.asrReady,
    audio: {
      sampleRate:
        providerCatalog.asr[session.asrProviderName]?.sampleRate ||
        providerCatalog.asr[DEFAULT_ASR_PROVIDER]?.sampleRate ||
        24000
    },
    providers: getProviderSummary(session),
    transcript: orderedTranscriptItems(session),
    notes: orderedNoteItems(session),
    snapshot: createSessionSnapshot(session)
  };
}

async function getSessionOrThrow(sessionId) {
  if (!sessionId) {
    throw new Error("Missing sessionId.");
  }

  const session = await sessionStore.get(sessionId);
  if (!session) {
    throw new Error("Session not found or expired.");
  }

  touchSession(session);
  await persistSession(session);
  return session;
}

setInterval(() => {
  void (async () => {
    const now = Date.now();
    const sessions = await sessionStore.values();
    for (const session of sessions) {
      if (session.sseClients.size > 0) {
        continue;
      }

      if (now - session.lastSeenAt > SESSION_TTL_MS) {
        await destroySession(session);
      }
    }
  })();
}, Math.min(SESSION_TTL_MS, 60_000)).unref();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    applyCors(req, res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      await serveFile(res, path.join(publicDir, "index.html"), "text/html; charset=utf-8");
      return;
    }

    if (req.method === "GET" && url.pathname === "/config.js") {
      await serveFile(res, path.join(publicDir, "config.js"), "text/javascript; charset=utf-8");
      return;
    }

    if (req.method === "GET" && url.pathname === "/app.js") {
      await serveFile(res, path.join(publicDir, "app.js"), "text/javascript; charset=utf-8");
      return;
    }

    if (req.method === "GET" && url.pathname === "/styles.css") {
      await serveFile(res, path.join(publicDir, "styles.css"), "text/css; charset=utf-8");
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, buildHealthPayload());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/providers") {
      json(res, 200, buildHealthPayload());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/session/state") {
      const sessionId = url.searchParams.get("sessionId");
      const session = await getSessionOrThrow(sessionId);
      json(res, 200, sessionStatePayload(session));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      const sessionId = url.searchParams.get("sessionId");

      if (!sessionId) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive"
        });
        res.write(
          `data: ${JSON.stringify({
            type: "bootstrap",
            sessionId: null,
            asrReady: false,
            audio: {
              sampleRate:
                providerCatalog.asr[DEFAULT_ASR_PROVIDER]?.sampleRate || 24000
            },
            providers: getProviderSummary(),
            transcript: [],
            notes: []
          })}\n\n`
        );
        res.end();
        return;
      }

      const session = await getSessionOrThrow(sessionId);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      });

      session.sseClients.add(res);
      res.write(`data: ${JSON.stringify(sessionBootstrapPayload(session))}\n\n`);

      req.on("close", () => {
        session.sseClients.delete(res);
        touchSession(session);
        void persistSession(session).catch(() => {});
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/session/start") {
      const body = await readJsonBody(req);
      const language =
        typeof body.language === "string" && body.language.trim()
          ? body.language.trim()
          : DEFAULT_LANGUAGE;
      const asrProviderName =
        typeof body.asrProvider === "string" && body.asrProvider.trim()
          ? body.asrProvider.trim()
          : DEFAULT_ASR_PROVIDER;
      const notesProviderName =
        typeof body.notesProvider === "string" && body.notesProvider.trim()
          ? body.notesProvider.trim()
          : DEFAULT_NOTES_PROVIDER;

      const session = await sessionStore.create();
      createNotesProvider(notesProviderName);
      const asrProvider = createAsrProvider(asrProviderName);

      session.sessionConfig.language = language;
      session.asrProviderName = asrProviderName;
      session.notesProviderName = notesProviderName;
      session.asrSession = asrProvider;
      await persistSession(session);

      asrProvider.startSession({
        language,
        onEvent: (message) => handleRealtimeEvent(session, message),
        onStatus: (event) => {
          session.asrReady = event.status === "connected";
          if (event.status === "disconnected") {
            session.asrSession = null;
          }
          void persistSession(session).catch(() => {});
          sendSessionEvent(session, {
            ...event,
            sessionId: session.id,
            providers: getProviderSummary(session)
          });
        }
      });

      json(res, 200, {
        ok: true,
        sessionId: session.id,
        language,
        audio: {
          sampleRate: providerCatalog.asr[asrProviderName]?.sampleRate || 24000
        },
        providers: getProviderSummary(session)
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/session/audio") {
      const body = await readJsonBody(req);
      const session = await getSessionOrThrow(body.sessionId);
      const audio = typeof body.audio === "string" ? body.audio : "";

      if (!session.asrSession || !session.asrReady) {
        json(res, 409, {
          error: "ASR session is not connected yet."
        });
        return;
      }

      if (!audio) {
        json(res, 400, { error: "Missing audio payload." });
        return;
      }

      session.asrSession.appendAudio(audio);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/session/stop") {
      const body = await readJsonBody(req);
      const session = await getSessionOrThrow(body.sessionId);
      destroySession(session);
      json(res, 200, { ok: true });
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (error) {
    json(res, 500, {
      error: error.message || "Unexpected server error."
    });
  }
});

server.listen(PORT, () => {
  console.log(`Interpreting notes prototype running at http://localhost:${PORT}`);
  for (const check of getStartupChecks()) {
    if (!check.ok) {
      console.warn(`[startup] ${check.message}`);
    }
  }
});
