const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const languageInput = document.getElementById("language");
const asrProviderSelect = document.getElementById("asrProvider");
const notesProviderSelect = document.getElementById("notesProvider");
const statusText = document.getElementById("statusText");
const transcriptList = document.getElementById("transcriptList");
const notesList = document.getElementById("notesList");
const appConfig = window.APP_CONFIG || {};
const apiBaseUrl = String(appConfig.apiBaseUrl || "").replace(/\/+$/, "");

const uiState = {
  sessionId: null,
  transcriptByItemId: new Map(),
  notesByItemId: new Map(),
  mediaStream: null,
  audioContext: null,
  processor: null,
  source: null,
  flushTimer: null,
  sampleBuffers: [],
  eventSource: null,
  providers: null,
  targetSampleRate: 24000
};

function setStatus(text) {
  statusText.textContent = text;
}

function apiUrl(pathname) {
  return apiBaseUrl ? `${apiBaseUrl}${pathname}` : pathname;
}

function renderProviderOptions(summary) {
  if (!summary) {
    return;
  }

  uiState.providers = summary;

  const sets = [
    {
      select: asrProviderSelect,
      options: summary.catalog.asr,
      active: summary.active.asr
    },
    {
      select: notesProviderSelect,
      options: summary.catalog.notes,
      active: summary.active.notes
    }
  ];

  for (const { select, options, active } of sets) {
    select.innerHTML = "";
    for (const option of options) {
      const el = document.createElement("option");
      el.value = option.name;
      const suffix = option.implemented
        ? option.configured === false
          ? " (needs key)"
          : ""
        : " (coming soon)";
      el.textContent = `${option.label}${suffix}`;
      el.disabled = !option.implemented || option.configured === false;
      el.selected = option.name === active;
      select.append(el);
    }
  }
}

function renderCards(container, items, formatText) {
  container.innerHTML = "";

  for (const item of items) {
    const card = document.createElement("article");
    card.className = `item-card ${item.status === "draft" ? "draft" : ""}`;

    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.innerHTML = `<span>${item.itemId}</span><span>${item.status}</span>`;

    const text = document.createElement("pre");
    text.className = "item-text";
    text.textContent = formatText(item);

    card.append(meta, text);
    container.append(card);
  }
}

function render() {
  const orderedTranscript = Array.from(uiState.transcriptByItemId.values())
    .sort((a, b) => a.order - b.order);
  const orderedNotes = Array.from(uiState.notesByItemId.values())
    .sort((a, b) => a.order - b.order);

  renderCards(transcriptList, orderedTranscript, (item) => item.text);
  renderCards(notesList, orderedNotes, (item) => item.lines.map((line) => {
    const indent = "  ".repeat(line.indent || 0);
    return `${indent}${line.text}`;
  }).join("\n"));
}

function floatToInt16(float32Array) {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i += 1) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

function downsampleToRate(input, inputRate, targetRate) {
  if (inputRate === targetRate) {
    return floatToInt16(input);
  }

  const ratio = inputRate / targetRate;
  const length = Math.round(input.length / ratio);
  const result = new Float32Array(length);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;

    for (let i = offsetBuffer; i < nextOffsetBuffer && i < input.length; i += 1) {
      accum += input[i];
      count += 1;
    }

    result[offsetResult] = count ? accum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return floatToInt16(result);
}

function int16ToBase64(chunks) {
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.length;
  }

  const merged = new Int16Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  const bytes = new Uint8Array(merged.buffer);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

async function flushAudio() {
  if (!uiState.sampleBuffers.length || !uiState.sessionId) {
    return;
  }

  const audio = int16ToBase64(uiState.sampleBuffers);
  uiState.sampleBuffers = [];

  await fetch(apiUrl("/api/session/audio"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sessionId: uiState.sessionId,
      audio
    })
  });
}

async function connectEvents(sessionId) {
  if (uiState.eventSource) {
    uiState.eventSource.close();
  }

  const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  const eventSource = new EventSource(`${apiUrl("/api/events")}${query}`);
  uiState.eventSource = eventSource;

  eventSource.onmessage = (event) => {
    const payload = JSON.parse(event.data);

    if (payload.type === "bootstrap") {
      uiState.sessionId = payload.sessionId || uiState.sessionId;
      uiState.targetSampleRate = payload.audio?.sampleRate || uiState.targetSampleRate;
      renderProviderOptions(payload.providers);
      uiState.transcriptByItemId.clear();
      uiState.notesByItemId.clear();

      for (const item of payload.transcript) {
        uiState.transcriptByItemId.set(item.itemId, item);
      }

      for (const note of payload.notes) {
        const transcript = uiState.transcriptByItemId.get(note.itemId);
        uiState.notesByItemId.set(note.itemId, {
          ...note,
          order: transcript?.order || 0
        });
      }

      render();
      return;
    }

    if (payload.type === "status") {
      if (payload.providers) {
        renderProviderOptions(payload.providers);
      }
      setStatus(payload.message);
      return;
    }

    if (payload.type === "error") {
      setStatus(payload.message);
      return;
    }

    if (payload.type === "transcript") {
      const previous = uiState.transcriptByItemId.get(payload.itemId);
      uiState.transcriptByItemId.set(payload.itemId, {
        itemId: payload.itemId,
        order: previous?.order || uiState.transcriptByItemId.size + 1,
        status: payload.status,
        text: payload.text
      });
      render();
      return;
    }

    if (payload.type === "notes") {
      const transcript = uiState.transcriptByItemId.get(payload.itemId);
      uiState.notesByItemId.set(payload.itemId, {
        itemId: payload.itemId,
        order: transcript?.order || uiState.notesByItemId.size + 1,
        status: payload.status,
        lines: payload.lines
      });
      render();
    }
  };
}

async function startCapture() {
  await connectEvents(null);

  const language = languageInput.value.trim() || "zh";
  const response = await fetch(apiUrl("/api/session/start"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      language,
      asrProvider: asrProviderSelect.value,
      notesProvider: notesProviderSelect.value
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Failed to start session.");
  }

  uiState.sessionId = payload.sessionId;
  uiState.targetSampleRate = payload.audio?.sampleRate || uiState.targetSampleRate;
  renderProviderOptions(payload.providers);
  await connectEvents(uiState.sessionId);

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });

  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (event) => {
    const channel = event.inputBuffer.getChannelData(0);
    uiState.sampleBuffers.push(
      downsampleToRate(channel, audioContext.sampleRate, uiState.targetSampleRate)
    );
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  uiState.mediaStream = stream;
  uiState.audioContext = audioContext;
  uiState.source = source;
  uiState.processor = processor;
  uiState.flushTimer = window.setInterval(() => {
    flushAudio().catch((error) => {
      setStatus(error.message);
    });
  }, 300);
}

async function stopCapture() {
  window.clearInterval(uiState.flushTimer);
  uiState.flushTimer = null;

  await flushAudio().catch(() => {});

  if (uiState.processor) {
    uiState.processor.disconnect();
    uiState.processor.onaudioprocess = null;
    uiState.processor = null;
  }

  if (uiState.source) {
    uiState.source.disconnect();
    uiState.source = null;
  }

  if (uiState.audioContext) {
    await uiState.audioContext.close();
    uiState.audioContext = null;
  }

  if (uiState.mediaStream) {
    for (const track of uiState.mediaStream.getTracks()) {
      track.stop();
    }
    uiState.mediaStream = null;
  }

  uiState.sampleBuffers = [];

  await fetch(apiUrl("/api/session/stop"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sessionId: uiState.sessionId
    })
  });

  uiState.sessionId = null;
}

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  try {
    await startCapture();
    stopButton.disabled = false;
    setStatus("正在监听麦克风并发送音频流");
  } catch (error) {
    setStatus(error.message);
    startButton.disabled = false;
  }
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  try {
    await stopCapture();
    setStatus("已停止");
  } finally {
    startButton.disabled = false;
  }
});

connectEvents(null).catch(() => {});
