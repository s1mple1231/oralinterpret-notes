import { createServer } from "node:http";
import { createHmac, randomInt, randomUUID } from "node:crypto";
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
const NOTES_DRAFT_DEBOUNCE_MS = Number(process.env.NOTES_DRAFT_DEBOUNCE_MS || 450);
const NOTES_DRAFT_MIN_CHARS = Number(process.env.NOTES_DRAFT_MIN_CHARS || 24);
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
const QWEN_ASR_API_KEY = process.env.QWEN_ASR_API_KEY || QWEN_API_KEY;
const QWEN_NOTES_API_KEY = process.env.QWEN_NOTES_API_KEY || QWEN_API_KEY;
const QWEN_ASR_MODEL = process.env.QWEN_ASR_MODEL || "qwen3-asr-flash-realtime";
const QWEN_ASR_BASE_URL =
  process.env.QWEN_ASR_BASE_URL || "wss://dashscope.aliyuncs.com/api-ws/v1/realtime";
const TENCENT_ASR_APP_ID = process.env.TENCENT_ASR_APP_ID || "";
const TENCENT_ASR_SECRET_ID = process.env.TENCENT_ASR_SECRET_ID || "";
const TENCENT_ASR_SECRET_KEY = process.env.TENCENT_ASR_SECRET_KEY || "";
const TENCENT_ASR_ENGINE_MODEL_TYPE = process.env.TENCENT_ASR_ENGINE_MODEL_TYPE || "";
const TENCENT_ASR_VOICE_FORMAT = Number(process.env.TENCENT_ASR_VOICE_FORMAT || 1);
const TENCENT_ASR_NEED_VAD = Number(process.env.TENCENT_ASR_NEED_VAD || 1);
const TENCENT_ASR_FILTER_DIRTY = Number(process.env.TENCENT_ASR_FILTER_DIRTY || 0);
const TENCENT_ASR_FILTER_MODAL = Number(process.env.TENCENT_ASR_FILTER_MODAL || 1);
const TENCENT_ASR_FILTER_PUNC = Number(process.env.TENCENT_ASR_FILTER_PUNC || 0);
const TENCENT_ASR_CONVERT_NUM_MODE = Number(process.env.TENCENT_ASR_CONVERT_NUM_MODE || 1);
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const MODELSCOPE_API_KEY = process.env.MODELSCOPE_API_KEY || "";
const MODELSCOPE_ENABLE_THINKING =
  String(process.env.MODELSCOPE_ENABLE_THINKING || "false").trim().toLowerCase() === "true";
const MODELSCOPE_THINKING_BUDGET = Number(process.env.MODELSCOPE_THINKING_BUDGET || 0);

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
    tencent: {
      label: "Tencent Cloud Realtime ASR",
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
        process.env.QWEN_NOTES_BASE_URL ||
        process.env.QWEN_BASE_URL ||
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: process.env.QWEN_MODEL || "qwen-plus",
      apiKey: QWEN_NOTES_API_KEY
    },
    deepseek: {
      label: "DeepSeek Notes",
      kind: "text_generation",
      implemented: true,
      baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      apiKey: DEEPSEEK_API_KEY
    },
    modelscope: {
      label: "ModelScope Notes",
      kind: "text_generation",
      implemented: true,
      baseUrl:
        process.env.MODELSCOPE_BASE_URL ||
        "https://api-inference.modelscope.cn/v1",
      model: process.env.MODELSCOPE_MODEL || "Qwen/Qwen3-32B",
      apiKey: MODELSCOPE_API_KEY,
      extraBody: {
        enable_thinking: MODELSCOPE_ENABLE_THINKING,
        ...(MODELSCOPE_THINKING_BUDGET > 0
          ? { thinking_budget: MODELSCOPE_THINKING_BUDGET }
          : {})
      }
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
        ok: Boolean(QWEN_ASR_API_KEY) || Boolean(QWEN_NOTES_API_KEY),
        message:
          "Provide QWEN_ASR_API_KEY and/or QWEN_NOTES_API_KEY (or fallback QWEN_API_KEY) for Qwen ASR and Notes."
      },
    {
      key: "openai_api_key",
      ok: Boolean(OPENAI_API_KEY),
      message: "OPENAI_API_KEY is required only when using OpenAI ASR or OpenAI Notes."
    },
      {
        key: "modelscope_api_key",
        ok: Boolean(MODELSCOPE_API_KEY),
        message: "MODELSCOPE_API_KEY is required only when using ModelScope Notes."
      },
      {
        key: "tencent_asr_config",
        ok:
          Boolean(TENCENT_ASR_APP_ID) &&
          Boolean(TENCENT_ASR_SECRET_ID) &&
          Boolean(TENCENT_ASR_SECRET_KEY) &&
          Boolean(TENCENT_ASR_ENGINE_MODEL_TYPE),
        message:
          "Tencent ASR requires TENCENT_ASR_APP_ID, TENCENT_ASR_SECRET_ID, TENCENT_ASR_SECRET_KEY, and TENCENT_ASR_ENGINE_MODEL_TYPE."
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
    lastEvent: null,
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
  if (payload.type === "error" || payload.type === "status") {
    session.lastEvent = {
      type: payload.type,
      status: payload.status || null,
      message: payload.message || ""
    };
  }

  if (payload.type === "error") {
    console.error(`[session:${session.id}] ${payload.message || "Unknown session error."}`);
  }

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
    lastEvent: session.lastEvent,
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
  session.lastEvent = snapshot.lastEvent || null;

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
    this.debugAudioChunkCount = 0;
  }

  startSession({ language, onEvent, onStatus }) {
    const wsUrl = `${this.config.baseUrl}?model=${encodeURIComponent(this.config.model)}`;
    console.log(
      `[qwen-asr] opening websocket model=${this.config.model} language=${language} sampleRate=${this.config.sampleRate}`
    );
    this.socket = new NodeWebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "OpenAI-Beta": "realtime=v1"
      }
    });

    this.socket.on("open", () => {
      this.ready = true;
      console.log("[qwen-asr] websocket connected");
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
        console.log(`[qwen-asr] event type=${payload?.type || "unknown"}`);
        await onEvent(payload);
      } catch (error) {
        onStatus({
          type: "error",
          message: `Failed to process qwen realtime event: ${error.message}`
        });
      }
    });

    this.socket.on("close", (code, reasonBuffer) => {
      this.ready = false;
      const reason =
        typeof reasonBuffer === "string" ? reasonBuffer : reasonBuffer?.toString?.("utf8") || "";
      console.log(`[qwen-asr] websocket closed code=${code} reason=${reason || "(none)"}`);
      onStatus({
        type: "status",
        status: "disconnected",
        message: `${this.config.label} disconnected.`
      });
    });

    this.socket.on("error", (error) => {
      console.error(`[qwen-asr] websocket error: ${error.message}`);
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

    this.debugAudioChunkCount += 1;
    if (this.debugAudioChunkCount <= 5 || this.debugAudioChunkCount % 10 === 0) {
      console.log(
        `[qwen-asr] append audio chunk=${this.debugAudioChunkCount} base64Length=${audio.length}`
      );
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
      console.log(
        `[qwen-asr] finishing session after ${this.debugAudioChunkCount} audio chunks sent`
      );
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

class TencentRealtimeAsrProvider {
  constructor(config) {
    this.config = config;
    this.socket = null;
    this.ready = false;
    this.voiceId = "";
  }

  buildSignedUrl() {
    const timestamp = Math.floor(Date.now() / 1000);
    const expired = timestamp + 60 * 60;
    const nonce = randomInt(100000, 999999999);
    this.voiceId = randomUUID().replace(/-/g, "").slice(0, 16);

    const params = new URLSearchParams();
    params.set("convert_num_mode", String(this.config.convertNumMode));
    params.set("engine_model_type", this.config.engineModelType);
    params.set("expired", String(expired));
    params.set("filter_dirty", String(this.config.filterDirty));
    params.set("filter_modal", String(this.config.filterModal));
    params.set("filter_punc", String(this.config.filterPunc));
    params.set("needvad", String(this.config.needVad));
    params.set("nonce", String(nonce));
    params.set("secretid", this.config.secretId);
    params.set("timestamp", String(timestamp));
    params.set("voice_format", String(this.config.voiceFormat));
    params.set("voice_id", this.voiceId);

    const sortedEntries = [...params.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    );
    const queryString = sortedEntries
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");

    const signSource = `asr.cloud.tencent.com/asr/v2/${this.config.appId}?${queryString}`;
    const signature = createHmac("sha1", this.config.secretKey)
      .update(signSource)
      .digest("base64");

    return `wss://asr.cloud.tencent.com/asr/v2/${this.config.appId}?${queryString}&signature=${encodeURIComponent(signature)}`;
  }

  startSession({ onEvent, onStatus }) {
    const wsUrl = this.buildSignedUrl();
    this.socket = new NodeWebSocket(wsUrl);

    this.socket.on("open", () => {
      onStatus({
        type: "status",
        status: "connecting",
        message: `${this.config.label} connecting.`
      });
    });

    this.socket.on("message", async (rawMessage, isBinary) => {
      if (isBinary) {
        return;
      }

      try {
        const payload = JSON.parse(String(rawMessage));

        if (payload.code !== 0) {
          onStatus({
            type: "error",
            message: payload.message || `${this.config.label} returned an error.`
          });
          return;
        }

        if (payload.voice_id && !payload.result && !payload.final) {
          this.ready = true;
          onStatus({
            type: "status",
            status: "connected",
            message: `${this.config.label} connected.`
          });
          return;
        }

        if (payload.result) {
          const itemId = `tencent_item_${payload.result.index ?? 0}`;
          const transcriptText = payload.result.voice_text_str || "";
          const sliceType = payload.result.slice_type;

          if (sliceType === 2) {
            await onEvent({
              type: "conversation.item.input_audio_transcription.completed",
              item_id: itemId,
              transcript: transcriptText
            });
            return;
          }

          if (sliceType === 0 || sliceType === 1) {
            await onEvent({
              type: "conversation.item.input_audio_transcription.text",
              item_id: itemId,
              text: transcriptText,
              stash: ""
            });
            return;
          }
        }

        if (payload.final === 1) {
          onStatus({
            type: "status",
            status: "disconnected",
            message: `${this.config.label} finished.`
          });
        }
      } catch (error) {
        onStatus({
          type: "error",
          message: `Failed to process Tencent ASR event: ${error.message}`
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
        message:
          error?.message || `${this.config.label} socket error. Check credentials and signature.`
      });
    });
  }

  appendAudio(audio) {
    if (!this.socket || !this.ready) {
      throw new Error("Tencent Cloud Realtime ASR is not connected yet.");
    }

    const buffer = Buffer.from(audio, "base64");
    this.socket.send(buffer, { binary: true });
  }

  stopSession() {
    if (this.socket && this.ready) {
      try {
        this.socket.send(JSON.stringify({ type: "end" }));
      } catch {
        // Ignore shutdown send errors.
      }
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

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
      `- mode: chinese_interpreting_notes`,
      `- target_language_bias: chinese notes`,
      `- glossary: []`,
      `- custom_abbreviations: []`,
      `- preferred_symbols: [\"->\", \"/\", \"?\", \"up\", \"down\"]`,
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

    const requestBody = {
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
      },
      ...(this.config.extraBody ? { extra_body: this.config.extraBody } : {})
    };

    const response = await callJsonApi(
      this.config.baseUrl,
      "/chat/completions",
      this.config.apiKey,
      requestBody
    );

    const rawContent = response?.choices?.[0]?.message?.content;
    const content =
      typeof rawContent === "string"
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent
              .map((part) =>
                typeof part === "string"
                  ? part
                  : typeof part?.text === "string"
                    ? part.text
                    : ""
              )
              .join("")
          : "";

    if (!content.trim()) {
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

    Promise.resolve(
      this.onEvent({
        type: "conversation.item.input_audio_transcription.text",
        item_id: itemId,
        text: draftText,
        stash: ""
      })
    ).catch((error) => {
      this.onStatus?.({
        type: "error",
        message: error.message || "Mock ASR failed to emit draft transcript."
      });
    });

    if (this.chunkCount % 6 === 0) {
      Promise.resolve(
        this.onEvent({
          type: "conversation.item.input_audio_transcription.completed",
          item_id: itemId,
          transcript: active.final
        })
      ).catch((error) => {
        this.onStatus?.({
          type: "error",
          message: error.message || "Mock ASR failed to emit final transcript."
        });
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
    if (!QWEN_ASR_API_KEY) {
      throw new Error(
        "Qwen Realtime ASR is not configured. Add QWEN_ASR_API_KEY (or fallback QWEN_API_KEY) to .env."
      );
    }

    return new QwenRealtimeAsrProvider({
      ...provider,
      apiKey: QWEN_ASR_API_KEY,
      model: QWEN_ASR_MODEL,
      baseUrl: QWEN_ASR_BASE_URL
    });
  }

  if (name === "tencent") {
    if (
      !TENCENT_ASR_APP_ID ||
      !TENCENT_ASR_SECRET_ID ||
      !TENCENT_ASR_SECRET_KEY ||
      !TENCENT_ASR_ENGINE_MODEL_TYPE
    ) {
      throw new Error(
        "Tencent Cloud Realtime ASR is not configured. Add TENCENT_ASR_APP_ID, TENCENT_ASR_SECRET_ID, TENCENT_ASR_SECRET_KEY, and TENCENT_ASR_ENGINE_MODEL_TYPE to .env."
      );
    }

    return new TencentRealtimeAsrProvider({
      ...provider,
      appId: TENCENT_ASR_APP_ID,
      secretId: TENCENT_ASR_SECRET_ID,
      secretKey: TENCENT_ASR_SECRET_KEY,
      engineModelType: TENCENT_ASR_ENGINE_MODEL_TYPE,
      voiceFormat: TENCENT_ASR_VOICE_FORMAT,
      needVad: TENCENT_ASR_NEED_VAD,
      filterDirty: TENCENT_ASR_FILTER_DIRTY,
      filterModal: TENCENT_ASR_FILTER_MODAL,
      filterPunc: TENCENT_ASR_FILTER_PUNC,
      convertNumMode: TENCENT_ASR_CONVERT_NUM_MODE
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
  if (session.asrProviderName === "qwen") {
    console.log(
      `[session:${session.id}] qwen event type=${message?.type || "unknown"} item=${message?.item_id || "n/a"}`
    );
  }

  if (
    message.type === "conversation.item.input_audio_transcription.delta" ||
    message.type === "conversation.item.input_audio_transcription.text"
  ) {
    const item = ensureItem(session, message.item_id);
    if (message.type === "conversation.item.input_audio_transcription.delta") {
      item.delta += message.delta || "";
    } else {
      item.delta = [message.text, message.stash].filter(Boolean).join("");
    }
    item.status = "draft";

    sendSessionEvent(session, {
      type: "transcript",
      itemId: item.itemId,
      status: "draft",
      text: item.delta
    });
    if (session.asrProviderName === "qwen") {
      console.log(
        `[session:${session.id}] transcript draft item=${item.itemId} length=${item.delta.length}`
      );
    }
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
    if (session.asrProviderName === "qwen") {
      console.log(
        `[session:${session.id}] transcript stable item=${item.itemId} length=${item.final.length}`
      );
    }
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
  }, NOTES_DRAFT_DEBOUNCE_MS);

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

  if (status === "draft" && transcriptText.trim().length < NOTES_DRAFT_MIN_CHARS) {
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
  } catch (error) {
    sendSessionEvent(session, {
      type: "error",
      message: `Notes generation failed: ${error.message || "Unknown provider error."}`
    });
    throw error;
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
    lastEvent: session.lastEvent,
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
      console.log(
        `[session:${session.id}] start requested asr=${asrProviderName} notes=${notesProviderName} language=${language}`
      );

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

      if (session.asrProviderName === "qwen") {
        const audioChunkCount = (session.debugAudioChunkCount || 0) + 1;
        session.debugAudioChunkCount = audioChunkCount;
        if (audioChunkCount <= 5 || audioChunkCount % 10 === 0) {
          console.log(
            `[session:${session.id}] received audio chunk=${audioChunkCount} base64Length=${audio.length}`
          );
        }
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
