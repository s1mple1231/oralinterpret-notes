import { useEffect, useRef, useState } from "react"
import {
  Activity,
  AudioLines,
  Bolt,
  CircleDot,
  Gauge,
  Languages,
  NotebookText,
  Radio,
  Sparkles,
  Volume2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"

type ProviderOption = {
  name: string
  label: string
  implemented: boolean
  configured?: boolean
  sampleRate?: number | null
}

type ProviderSummary = {
  active: {
    asr: string
    notes: string
  }
  catalog: {
    asr: ProviderOption[]
    notes: ProviderOption[]
  }
}

type TranscriptItem = {
  itemId: string
  order: number
  status: string
  text?: string
  delta?: string
  final?: string
}

type NoteLine = {
  id: string
  text: string
  indent: number
}

type NotesItem = {
  itemId: string
  order: number
  status: string
  lines: NoteLine[]
}

type SessionEvent = {
  type: string
  status?: string | null
  message?: string
}

type AudioMode = "mic" | "system" | "mic_system"

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "")

function apiUrl(pathname: string) {
  return API_BASE_URL ? `${API_BASE_URL}${pathname}` : pathname
}

function floatToInt16(float32Array: Float32Array) {
  const int16 = new Int16Array(float32Array.length)
  for (let i = 0; i < float32Array.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, float32Array[i]))
    int16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return int16
}

function downsampleToRate(input: Float32Array, inputRate: number, targetRate: number) {
  if (inputRate === targetRate) {
    return floatToInt16(input)
  }

  const ratio = inputRate / targetRate
  const length = Math.round(input.length / ratio)
  const result = new Float32Array(length)
  let offsetResult = 0
  let offsetBuffer = 0

  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio)
    let accum = 0
    let count = 0

    for (let i = offsetBuffer; i < nextOffsetBuffer && i < input.length; i += 1) {
      accum += input[i]
      count += 1
    }

    result[offsetResult] = count ? accum / count : 0
    offsetResult += 1
    offsetBuffer = nextOffsetBuffer
  }

  return floatToInt16(result)
}

function int16ChunksToBase64(chunks: Int16Array[]) {
  let totalLength = 0
  for (const chunk of chunks) {
    totalLength += chunk.length
  }

  const merged = new Int16Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }

  const bytes = new Uint8Array(merged.buffer)
  let binary = ""
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(binary)
}

function calculateRms(samples: Float32Array) {
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i]
    sum += value * value
  }
  return Math.sqrt(sum / samples.length)
}

function audioModeLabel(mode: AudioMode) {
  if (mode === "mic") return "仅麦克风"
  if (mode === "system") return "仅系统声音"
  return "麦克风 + 系统声音"
}

export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [language, setLanguage] = useState("zh")
  const [status, setStatus] = useState("空闲")
  const [targetSampleRate, setTargetSampleRate] = useState(16000)
  const [providers, setProviders] = useState<ProviderSummary | null>(null)
  const [selectedAsr, setSelectedAsr] = useState("mock")
  const [selectedNotes, setSelectedNotes] = useState("mock")
  const [transcripts, setTranscripts] = useState<Map<string, TranscriptItem>>(new Map())
  const [notes, setNotes] = useState<Map<string, NotesItem>>(new Map())
  const [isListening, setIsListening] = useState(false)
  const [audioMode, setAudioMode] = useState<AudioMode>("mic")
  const [audioLevel, setAudioLevel] = useState(0)
  const [inputSourceText, setInputSourceText] = useState("未开始")
  const [systemAudioTrackState, setSystemAudioTrackState] = useState("未启用")

  const micStreamRef = useRef<MediaStream | null>(null)
  const displayStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sinkRef = useRef<GainNode | null>(null)
  const flushTimerRef = useRef<number | null>(null)
  const statePollTimerRef = useRef<number | null>(null)
  const sampleBuffersRef = useRef<Int16Array[]>([])

  function syncProviderSelections(summary: ProviderSummary) {
    setProviders(summary)
    setSelectedAsr(summary.active.asr)
    setSelectedNotes(summary.active.notes)
  }

  function applySessionSnapshot(payload: {
    sessionId?: string | null
    audio?: { sampleRate?: number }
    providers?: ProviderSummary
    transcript?: TranscriptItem[]
    notes?: NotesItem[]
    lastEvent?: SessionEvent | null
  }) {
    setSessionId(payload.sessionId || null)
    setTargetSampleRate(payload.audio?.sampleRate || 16000)
    if (payload.providers) {
      syncProviderSelections(payload.providers)
    }
    if (payload.lastEvent?.message) {
      setStatus(payload.lastEvent.message)
    }

    setTranscripts((previous) => {
      const next = new Map(previous)
      for (const item of payload.transcript ?? []) {
        next.set(item.itemId, {
          itemId: item.itemId,
          order: item.order,
          status: item.status,
          text: item.final || item.delta || item.text || "",
        })
      }
      return next
    })

    setNotes((previous) => {
      const next = new Map(previous)
      for (const item of payload.notes ?? []) {
        next.set(item.itemId, {
          itemId: item.itemId,
          order:
            payload.transcript?.find((entry) => entry.itemId === item.itemId)?.order ||
            previous.get(item.itemId)?.order ||
            0,
          status: item.status,
          lines: item.lines || [],
        })
      }
      return next
    })
  }

  async function flushAudio() {
    if (!sampleBuffersRef.current.length || !sessionId) {
      return
    }

    const audio = int16ChunksToBase64(sampleBuffersRef.current)
    sampleBuffersRef.current = []

    await fetch(apiUrl("/api/session/audio"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        audio,
      }),
    })
  }

  function stopStatePolling() {
    if (statePollTimerRef.current) {
      window.clearInterval(statePollTimerRef.current)
      statePollTimerRef.current = null
    }
  }

  function clearStreams() {
    setTranscripts(new Map())
    setNotes(new Map())
  }

  async function pollSessionState(nextSessionId: string) {
    const response = await fetch(
      `${apiUrl("/api/session/state")}?sessionId=${encodeURIComponent(nextSessionId)}`,
    )
    const payload = await response.json()
    if (!response.ok) {
      if (payload.error === "Session not found or expired.") {
        stopStatePolling()
        setIsListening(false)
      }
      throw new Error(payload.error || "Failed to fetch session state.")
    }

    applySessionSnapshot(payload)
  }

  function startStatePolling(nextSessionId: string | null) {
    stopStatePolling()
    if (!nextSessionId) {
      return
    }

    void pollSessionState(nextSessionId).catch((error: Error) => setStatus(error.message))

    statePollTimerRef.current = window.setInterval(() => {
      void pollSessionState(nextSessionId).catch((error: Error) => setStatus(error.message))
    }, 300)
  }

  async function stopCapture() {
    if (flushTimerRef.current) {
      window.clearInterval(flushTimerRef.current)
      flushTimerRef.current = null
    }

    await flushAudio().catch(() => {})

    processorRef.current?.disconnect()
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null
    }
    processorRef.current = null

    sourceRef.current?.disconnect()
    sourceRef.current = null

    if (audioContextRef.current) {
      await audioContextRef.current.close()
    }
    audioContextRef.current = null
    sinkRef.current = null

    if (micStreamRef.current) {
      for (const track of micStreamRef.current.getTracks()) {
        track.stop()
      }
    }
    micStreamRef.current = null

    if (displayStreamRef.current) {
      for (const track of displayStreamRef.current.getTracks()) {
        track.stop()
      }
    }
    displayStreamRef.current = null
    sampleBuffersRef.current = []

    if (sessionId) {
      await fetch(apiUrl("/api/session/stop"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId }),
      }).catch(() => {})
    }

    setSessionId(null)
    setIsListening(false)
    setStatus("空闲")
    setAudioLevel(0)
    setInputSourceText("未开始")
    setSystemAudioTrackState("未启用")
    stopStatePolling()
  }

  async function startCapture() {
    const response = await fetch(apiUrl("/api/session/start"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        language,
        asrProvider: selectedAsr,
        notesProvider: selectedNotes,
      }),
    })

    const payload = await response.json()
    if (!response.ok) {
      throw new Error(payload.error || "Failed to start session.")
    }

    setSessionId(payload.sessionId)
    setTargetSampleRate(payload.audio?.sampleRate || 16000)
    if (payload.providers) {
      syncProviderSelections(payload.providers)
    }
    startStatePolling(payload.sessionId)

    const needsMic = audioMode === "mic" || audioMode === "mic_system"
    const needsSystemAudio = audioMode === "system" || audioMode === "mic_system"
    setInputSourceText(audioModeLabel(audioMode))
    setSystemAudioTrackState(needsSystemAudio ? "等待共享" : "未启用")

    const micStream = needsMic
      ? await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
      : null

    let displayStream: MediaStream | null = null
    if (needsSystemAudio) {
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        })
      } catch (error) {
        await fetch(apiUrl("/api/session/stop"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sessionId: payload.sessionId }),
        }).catch(() => {})
        throw new Error(
          error instanceof Error
            ? `系统声音采集未开启：${error.message}`
            : "系统声音采集未开启。",
        )
      }
    }

    const audioContext = new AudioContext()
    const destination = audioContext.createMediaStreamDestination()
    const source = audioContext.createMediaStreamSource(destination.stream)
    const processor = audioContext.createScriptProcessor(4096, 1, 1)
    const silentSink = audioContext.createGain()
    silentSink.gain.value = 0

    if (micStream) {
      const micSource = audioContext.createMediaStreamSource(micStream)
      micSource.connect(destination)
    }

    const displayAudioTrack = displayStream?.getAudioTracks?.()[0]
    if (displayStream && displayAudioTrack) {
      const displayAudioOnly = new MediaStream([displayAudioTrack])
      const displaySource = audioContext.createMediaStreamSource(displayAudioOnly)
      displaySource.connect(destination)
      setSystemAudioTrackState("已获取")

      if (audioMode === "mic_system") {
        setStatus("监听中（麦克风 + 系统声音）")
      } else if (audioMode === "system") {
        setStatus("监听中（仅系统声音）")
      }
    } else if (needsSystemAudio) {
      setSystemAudioTrackState("未拿到音轨")
      if (audioMode === "mic_system") {
        setStatus("监听中（仅麦克风，当前共享源未带系统声音）")
      } else {
        setStatus("监听中（未采集到系统声音）")
      }
    }

    processor.onaudioprocess = (event) => {
      const channel = event.inputBuffer.getChannelData(0)
      const rms = calculateRms(channel)
      setAudioLevel((previous) => Math.max(Math.min(rms * 6, 1), previous * 0.75))
      sampleBuffersRef.current.push(
        downsampleToRate(channel, audioContext.sampleRate, targetSampleRate),
      )
    }

    source.connect(processor)
    processor.connect(silentSink)
    silentSink.connect(audioContext.destination)

    micStreamRef.current = micStream
    displayStreamRef.current = displayStream
    audioContextRef.current = audioContext
    sourceRef.current = source
    processorRef.current = processor
    sinkRef.current = silentSink
    flushTimerRef.current = window.setInterval(() => {
      flushAudio().catch((error: Error) => setStatus(error.message))
    }, 300)

    setIsListening(true)
    if (audioMode === "mic") {
      setStatus("监听中")
    }
  }

  useEffect(() => {
    fetch(apiUrl("/api/providers"))
      .then((response) => response.json())
      .then((payload) => {
        if (payload.providers) {
          syncProviderSelections(payload.providers)
        }
      })
      .catch(() => {})

    return () => {
      stopStatePolling()
      void stopCapture()
    }
  }, [])

  const transcriptItems = Array.from(transcripts.values()).sort((a, b) => a.order - b.order)
  const noteItems = Array.from(notes.values()).sort((a, b) => a.order - b.order)

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="glass-grid absolute inset-0 opacity-45" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-4 py-5 md:px-8 md:py-8">
        <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr] xl:items-stretch">
          <Card className="overflow-hidden border-transparent bg-[linear-gradient(135deg,rgba(255,255,255,0.9),rgba(249,251,247,0.72))]">
            <CardHeader className="h-full pb-4">
              <div className="grid h-full gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-stretch">
                <div className="flex h-full flex-col justify-between gap-10">
                  <div className="space-y-4">
                    <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">
                      口译控制台
                    </p>
                    <h1 className="max-w-3xl text-4xl font-semibold leading-[0.98] tracking-tight md:text-6xl">
                      实时口译笔记
                    </h1>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <MiniTile icon={AudioLines} title="流式状态" value="实时" />
                    <MiniTile icon={Bolt} title="刷新节奏" value="300ms" />
                    <MiniTile icon={Sparkles} title="模式" value="简洁" />
                  </div>
                </div>

                <div className="flex h-full flex-col">
                  <Card className="h-full border-border/70 bg-white/70">
                    <CardContent className="grid h-full gap-4 p-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                            会话
                          </p>
                          <p className="mt-1 text-sm font-medium text-foreground">{status}</p>
                        </div>
                        <div className="rounded-full bg-primary/10 p-2 text-primary">
                          <CircleDot className="h-4 w-4" />
                        </div>
                      </div>
                      <Separator />
                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <Metric icon={Radio} label="ASR" value={selectedAsr} />
                        <Metric icon={NotebookText} label="Notes" value={selectedNotes} />
                        <Metric icon={Gauge} label="Rate" value={`${targetSampleRate / 1000}k`} />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </CardHeader>
          </Card>

          <Card className="h-full bg-[linear-gradient(180deg,rgba(17,23,20,0.95),rgba(22,30,25,0.92))] text-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-white">控制面板</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ControlField
                label="语言提示"
                icon={Languages}
                input={
                  <Input
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    placeholder="zh / en / ja"
                    className="border-white/10 bg-white/5 text-white placeholder:text-white/35"
                  />
                }
              />
              <ControlField
                label="ASR 提供方"
                icon={Activity}
                input={
                  <NativeSelect
                    value={selectedAsr}
                    onChange={(event) => setSelectedAsr(event.target.value)}
                    shellClassName="border-white/10 bg-white/5"
                    className="text-white"
                  >
                    {providers?.catalog.asr.map((provider) => (
                      <option
                        key={provider.name}
                        value={provider.name}
                        disabled={!provider.implemented}
                      >
                        {provider.label}
                      </option>
                    ))}
                  </NativeSelect>
                }
              />
              <ControlField
                label="笔记提供方"
                icon={NotebookText}
                input={
                  <NativeSelect
                    value={selectedNotes}
                    onChange={(event) => setSelectedNotes(event.target.value)}
                    shellClassName="border-white/10 bg-white/5"
                    className="text-white"
                  >
                    {providers?.catalog.notes.map((provider) => (
                      <option
                        key={provider.name}
                        value={provider.name}
                        disabled={!provider.implemented || provider.configured === false}
                      >
                        {provider.label}
                      </option>
                    ))}
                  </NativeSelect>
                }
              />
              <ControlField
                label="音频模式"
                icon={AudioLines}
                input={
                  <NativeSelect
                    value={audioMode}
                    onChange={(event) => setAudioMode(event.target.value as AudioMode)}
                    disabled={isListening}
                    shellClassName="border-white/10 bg-white/5"
                    className="text-white"
                  >
                    <option value="mic">仅麦克风</option>
                    <option value="system">仅系统声音</option>
                    <option value="mic_system">麦克风 + 系统声音</option>
                  </NativeSelect>
                }
              />

              <AudioDiagnostics
                inputSourceText={inputSourceText}
                systemAudioTrackState={systemAudioTrackState}
                audioLevel={audioLevel}
              />

              <div className="flex flex-wrap gap-3 pt-2">
                <Button onClick={() => void startCapture()} disabled={isListening} size="lg">
                  开始监听
                </Button>
                <Button
                  onClick={() => void stopCapture()}
                  disabled={!isListening}
                  variant="outline"
                  size="lg"
                  className="border-white/12 bg-white/0 text-white hover:bg-white/8"
                >
                  停止
                </Button>
                <Button
                  onClick={clearStreams}
                  disabled={isListening || (!transcripts.size && !notes.size)}
                  variant="outline"
                  size="lg"
                  className="border-white/12 bg-white/0 text-white hover:bg-white/8"
                >
                  清空
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="mt-5 grid flex-1 gap-5 xl:grid-cols-[0.92fr_1.08fr]">
          <StreamPane
            title="转写流"
            tag="ASR"
            items={transcriptItems.map((item) => ({
              key: item.itemId,
              status: item.status,
              title: item.itemId,
              body: item.text || "",
            }))}
          />

          <StreamPane
            title="口译笔记"
            tag="NOTES"
            noteMode
            items={noteItems.map((item) => ({
              key: item.itemId,
              status: item.status,
              title: item.itemId,
              body: item.lines.map((line) => `${"  ".repeat(line.indent || 0)}${line.text}`).join("\n"),
            }))}
          />
        </section>
      </div>
    </div>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Radio
  label: string
  value: string
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-3">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] uppercase tracking-[0.24em]">{label}</span>
      </div>
      <p className="truncate text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}

function MiniTile({
  icon: Icon,
  title,
  value,
}: {
  icon: typeof AudioLines
  title: string
  value: string
}) {
  return (
    <Card className="border-border/70 bg-white/72">
      <CardContent className="p-4">
        <div className="mb-2 inline-flex rounded-full bg-primary/10 p-2 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{title}</p>
        <p className="mt-1 text-sm font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}

function ControlField({
  label,
  icon: Icon,
  input,
}: {
  label: string
  icon: typeof Languages
  input: React.ReactNode
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2 text-sm text-white/70">
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
      {input}
    </div>
  )
}

function AudioDiagnostics({
  inputSourceText,
  systemAudioTrackState,
  audioLevel,
}: {
  inputSourceText: string
  systemAudioTrackState: string
  audioLevel: number
}) {
  return (
    <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center gap-2 text-sm text-white/70">
        <Volume2 className="h-4 w-4" />
        <span>音频诊断</span>
      </div>
      <div className="grid gap-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/60">当前输入</span>
          <span className="text-white">{inputSourceText}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/60">系统音频轨</span>
          <span className="text-white">{systemAudioTrackState}</span>
        </div>
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-white/60">实时电平</span>
          <span className="text-white">{Math.round(audioLevel * 100)}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-emerald-400 transition-[width] duration-150"
            style={{ width: `${Math.max(4, Math.round(audioLevel * 100))}%` }}
          />
        </div>
      </div>
    </div>
  )
}

function StreamPane({
  title,
  tag,
  items,
  noteMode = false,
}: {
  title: string
  tag: string
  items: { key: string; status: string; title: string; body: string }[]
  noteMode?: boolean
}) {
  return (
    <Card className="flex min-h-[42rem] flex-col">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{title}</CardTitle>
          <Badge>{tag}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <div className="grid gap-3">
          {items.length ? (
            items.map((item) => (
              <article
                key={item.key}
                className={`rounded-[22px] border border-border/80 bg-background/80 p-4 shadow-sm ${
                  item.status === "draft" ? "border-dashed" : ""
                }`}
              >
                <div className="mb-3 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                  <span>{item.title}</span>
                  <span>{item.status}</span>
                </div>
                <pre
                  className={`whitespace-pre-wrap text-sm leading-7 ${
                    noteMode
                      ? "font-mono text-[13px] leading-6 tracking-tight text-foreground"
                      : "font-sans text-[14px] text-foreground"
                  }`}
                >
                  {item.body}
                </pre>
              </article>
            ))
          ) : (
            <div className="flex min-h-[24rem] items-center justify-center rounded-[24px] border border-dashed border-border bg-muted/40 px-6 text-center text-sm leading-7 text-muted-foreground">
              暂无内容。
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
