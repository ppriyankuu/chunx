# Chunx — Technical Design Document

## What Is This

Chunx is a peer-to-peer file sharing web app. Two users open the site, one creates a session and shares a 5-character code, the other joins with that code. After that, files transfer directly between the two browsers — the server never sees the file data.

The key goals:
- Support very large files (1GB, 2GB+) without crashing the browser
- No file storage on any server
- Keep memory usage flat on both sender and receiver sides
- Handle real-world network conditions (backpressure, dead connections, ICE timing)

---

## System Architecture

```
UserA ──(WebSocket signaling)──► Connection Server ◄──(WebSocket signaling)── UserB
  │                                                                               │
  └───────────────────── WebRTC DataChannel (P2P, file data) ───────────────────┘
```

The server's only job is to broker the WebRTC handshake. Once the DataChannel is open, the server is out of the picture entirely.

**Stack:**
- **Frontend:** Next.js (pages router) + TypeScript
- **Backend:** Node.js + `ws` library (no Express)
- **P2P:** WebRTC `RTCPeerConnection` + `RTCDataChannel` (built into browsers)
- **File reading:** Browser File API (`file.slice().arrayBuffer()`)
- **File writing:** StreamSaver.js (streams chunks directly to disk)
- **Network traversal:** Free public STUN server (Google)

---

## Project Structure

```
chunx/
├── server/
│   ├── src/
│   │   ├── index.ts            ← HTTP + WebSocket server entry
│   │   ├── sessionManager.ts   ← room creation, join, peer lookup, cleanup
│   │   ├── relay.ts            ← message routing (signaling)
│   │   └── types.ts            ← discriminated union message types + send helper
│   ├── package.json
│   └── tsconfig.json
│
└── client/                     ← Next.js app
    ├── src/
    │   ├── pages/
    │   │   ├── index.tsx                ← home (create / join)
    │   │   └── session/[code].tsx       ← session page (full WebRTC + transfer logic)
    │   ├── lib/
    │   │   ├── signalingClient.ts       ← typed WebSocket wrapper
    │   │   ├── peerConnection.ts        ← RTCPeerConnection + DataChannel setup
    │   │   ├── fileSender.ts            ← chunking + backpressure
    │   │   ├── fileReceiver.ts          ← StreamSaver + chunk writing
    │   │   └── types.ts                 ← shared types
    │   └── components/
    │       ├── DropZone.tsx
    │       └── ProgressBar.tsx
    ├── package.json
    └── tsconfig.json
```

---

## Backend — Node.js + `ws`

**Dependencies:**
```bash
npm install ws
npm install -D typescript @types/ws @types/node ts-node
```

No Express. Node's built-in `http` module is enough — you only need WebSocket and one optional health-check route.

---

### `types.ts` — The Signaling Protocol

This is the most important thing to nail first. Every message over WebSocket is a discriminated union so TypeScript can narrow it properly on both sides.

```ts
// server/src/types.ts

// Messages CLIENT → SERVER
export type ClientMessage =
  | { type: 'CREATE_SESSION' }
  | { type: 'JOIN_SESSION'; code: string }
  | { type: 'OFFER'; sdp: RTCSessionDescriptionInit }
  | { type: 'ANSWER'; sdp: RTCSessionDescriptionInit }
  | { type: 'ICE_CANDIDATE'; candidate: RTCIceCandidateInit }
  | { type: 'PONG' }

// Messages SERVER → CLIENT
export type ServerMessage =
  | { type: 'SESSION_CREATED'; code: string }
  | { type: 'SESSION_JOINED'; code: string }   // sent to the joiner
  | { type: 'PEER_JOINED' }                    // sent to the creator when joiner arrives
  | { type: 'SESSION_NOT_FOUND' }
  | { type: 'SESSION_FULL' }
  | { type: 'OFFER'; sdp: RTCSessionDescriptionInit }
  | { type: 'ANSWER'; sdp: RTCSessionDescriptionInit }
  | { type: 'ICE_CANDIDATE'; candidate: RTCIceCandidateInit }
  | { type: 'PEER_DISCONNECTED' }
  | { type: 'PING' }

// Strongly typed send helper
export function send(ws: import('ws').WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}
```

---

### `sessionManager.ts` — Room Logic

```ts
// server/src/sessionManager.ts
import { WebSocket } from 'ws'

interface Session {
  code: string
  peers: [WebSocket] | [WebSocket, WebSocket]
  createdAt: number
}

// Two maps: sessions by code, and a reverse lookup from ws → session code
const sessions = new Map<string, Session>()
const peerIndex = new Map<WebSocket, string>()

// No O/0/1/I — those are hard to read or confuse visually
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateCode(): string {
  let code: string
  do {
    code = Array.from(
      { length: 5 },
      () => CHARS[Math.floor(Math.random() * CHARS.length)]
    ).join('')
  } while (sessions.has(code)) // guarantee uniqueness
  return code
}

export function createSession(ws: WebSocket): string {
  const code = generateCode()
  sessions.set(code, { code, peers: [ws], createdAt: Date.now() })
  peerIndex.set(ws, code)
  return code
}

export function joinSession(
  ws: WebSocket,
  code: string
): 'ok' | 'not_found' | 'full' {
  const session = sessions.get(code)
  if (!session) return 'not_found'
  if (session.peers.length === 2) return 'full'
  ;(session.peers as WebSocket[]).push(ws)
  peerIndex.set(ws, code)
  return 'ok'
}

// Returns the other peer in the same session, or null
export function getOtherPeer(ws: WebSocket): WebSocket | null {
  const code = peerIndex.get(ws)
  if (!code) return null
  const session = sessions.get(code)
  if (!session) return null
  return session.peers.find(p => p !== ws) ?? null
}

// Call this when a WebSocket closes
export function removePeer(ws: WebSocket): WebSocket | null {
  const code = peerIndex.get(ws)
  if (!code) return null
  peerIndex.delete(ws)
  const session = sessions.get(code)
  if (!session) return null

  const otherPeer = session.peers.find(p => p !== ws) ?? null
  const remaining = session.peers.filter(p => p !== ws)

  if (remaining.length === 0) {
    sessions.delete(code) // both gone — clean up entirely
  } else {
    session.peers = remaining as [WebSocket]
  }

  return otherPeer
}
```

---

### `relay.ts` — Message Routing

The server never interprets OFFER/ANSWER/ICE_CANDIDATE — it just forwards them. Only session management messages have actual logic here.

```ts
// server/src/relay.ts
import { WebSocket } from 'ws'
import { ClientMessage, send } from './types'
import { createSession, joinSession, getOtherPeer, removePeer } from './sessionManager'

export function handleMessage(ws: WebSocket, raw: string) {
  let msg: ClientMessage
  try {
    msg = JSON.parse(raw) as ClientMessage
  } catch {
    return // malformed JSON — ignore silently
  }

  switch (msg.type) {
    case 'CREATE_SESSION': {
      const code = createSession(ws)
      send(ws, { type: 'SESSION_CREATED', code })
      break
    }

    case 'JOIN_SESSION': {
      const result = joinSession(ws, msg.code)
      if (result === 'not_found') {
        send(ws, { type: 'SESSION_NOT_FOUND' })
      } else if (result === 'full') {
        send(ws, { type: 'SESSION_FULL' })
      } else {
        send(ws, { type: 'SESSION_JOINED', code: msg.code })
        // Tell the creator their peer arrived — this triggers the WebRTC handshake
        const creator = getOtherPeer(ws)
        if (creator) send(creator, { type: 'PEER_JOINED' })
      }
      break
    }

    // Pure relay — server doesn't inspect these, just forwards
    case 'OFFER': {
      const peer = getOtherPeer(ws)
      if (peer) send(peer, { type: 'OFFER', sdp: msg.sdp })
      break
    }

    case 'ANSWER': {
      const peer = getOtherPeer(ws)
      if (peer) send(peer, { type: 'ANSWER', sdp: msg.sdp })
      break
    }

    case 'ICE_CANDIDATE': {
      const peer = getOtherPeer(ws)
      if (peer) send(peer, { type: 'ICE_CANDIDATE', candidate: msg.candidate })
      break
    }

    case 'PONG':
      // Mark connection as alive — heartbeat handled in index.ts
      ;(ws as any)._isAlive = true
      break
  }
}

export function handleClose(ws: WebSocket) {
  const otherPeer = removePeer(ws)
  if (otherPeer) {
    send(otherPeer, { type: 'PEER_DISCONNECTED' })
  }
}
```

---

### `index.ts` — Server Entry

```ts
// server/src/index.ts
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { handleMessage, handleClose } from './relay'
import { send } from './types'

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200)
    res.end('ok')
    return
  }
  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({ server: httpServer })

// Heartbeat — the ws library doesn't handle dead connections automatically.
// Without this, browsers that close without a clean disconnect (tab crash,
// network drop) stay in the sessions map forever.
// Pattern: server sends PING every 30s. Client must reply PONG.
// If a client misses one, terminate it.
const HEARTBEAT_INTERVAL = 30_000

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if ((ws as any)._isAlive === false) {
      ws.terminate()
      return
    }
    ;(ws as any)._isAlive = false
    send(ws, { type: 'PING' })
  })
}, HEARTBEAT_INTERVAL)

wss.on('close', () => clearInterval(heartbeat))

wss.on('connection', (ws: WebSocket) => {
  ;(ws as any)._isAlive = true

  ws.on('message', (data) => {
    handleMessage(ws, data.toString())
  })

  ws.on('close', () => {
    handleClose(ws)
  })

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message)
    // Don't crash the server — just log
  })
})

httpServer.listen(PORT, () => {
  console.log(`Signaling server running on ws://localhost:${PORT}`)
})
```

That's the entire backend. No database, no file storage, no business logic — just a typed relay and a session map.

---

## WebRTC Layer — Client

**Dependencies:**
```bash
npm install streamsaver
npm install -D @types/streamsaver
```

WebRTC itself is built into every browser — no library needed.

---

### `types.ts` (Client) — DataChannel Message Protocol

```ts
// client/src/lib/types.ts

// Signaling messages (over WebSocket)
export type ServerMessage =
  | { type: 'SESSION_CREATED'; code: string }
  | { type: 'SESSION_JOINED'; code: string }
  | { type: 'PEER_JOINED' }
  | { type: 'SESSION_NOT_FOUND' }
  | { type: 'SESSION_FULL' }
  | { type: 'OFFER'; sdp: RTCSessionDescriptionInit }
  | { type: 'ANSWER'; sdp: RTCSessionDescriptionInit }
  | { type: 'ICE_CANDIDATE'; candidate: RTCIceCandidateInit }
  | { type: 'PEER_DISCONNECTED' }
  | { type: 'PING' }

export type ClientMessage =
  | { type: 'CREATE_SESSION' }
  | { type: 'JOIN_SESSION'; code: string }
  | { type: 'OFFER'; sdp: RTCSessionDescriptionInit }
  | { type: 'ANSWER'; sdp: RTCSessionDescriptionInit }
  | { type: 'ICE_CANDIDATE'; candidate: RTCIceCandidateInit }
  | { type: 'PONG' }

// Messages over the RTCDataChannel (P2P, after handshake is complete)
// String messages are JSON of this type. Binary messages are raw ArrayBuffer chunks.
export type DataChannelControlMessage =
  | {
      type: 'FILE_START'
      name: string
      size: number       // bytes
      mimeType: string
      totalChunks: number
    }
  | { type: 'FILE_END'; name: string }

// Transfer state — drives the session page UI
export type TransferState =
  | { phase: 'idle' }
  | { phase: 'sending';   fileName: string; progress: number }  // 0–1
  | { phase: 'receiving'; fileName: string; progress: number }  // 0–1
  | { phase: 'done';      fileName: string; direction: 'sent' | 'received' }
```

---

### `signalingClient.ts` — WebSocket Wrapper

Abstracts the raw WebSocket into a typed event emitter so no other module ever calls `JSON.parse` directly.

```ts
// client/src/lib/signalingClient.ts
import { ClientMessage, ServerMessage } from './types'

type MessageHandler = (msg: ServerMessage) => void

export class SignalingClient {
  private ws: WebSocket
  private handlers: MessageHandler[] = []

  constructor(private url: string) {
    this.ws = this.connect()
  }

  private connect(): WebSocket {
    const ws = new WebSocket(this.url)

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage
        // Handle PING immediately — don't bubble it up to callers
        if (msg.type === 'PING') {
          this.send({ type: 'PONG' })
          return
        }
        this.handlers.forEach(h => h(msg))
      } catch {
        // ignore malformed messages
      }
    }

    ws.onerror = (err) => console.error('WS error', err)
    ws.onclose = () => {
      // Optional: add auto-reconnect logic here
    }

    return ws
  }

  send(msg: ClientMessage) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  onMessage(handler: MessageHandler) {
    this.handlers.push(handler)
    // Returns an unsubscribe function
    return () => {
      this.handlers = this.handlers.filter(h => h !== handler)
    }
  }

  close() {
    this.ws.close()
  }
}
```

---

### `peerConnection.ts` — RTCPeerConnection + DataChannel

The creator of the session is the WebRTC **initiator** — they call `createOffer`. The joiner is the **answerer**. The initiator creates the DataChannel; the answerer receives it via `ondatachannel`. Because `RTCDataChannel` is bidirectional, both sides can call `.send()` on it freely — no need for two separate channels.

```ts
// client/src/lib/peerConnection.ts
import { SignalingClient } from './signalingClient'
import { DataChannelControlMessage } from './types'

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

const DATACHANNEL_LABEL = 'chunx-transfer'

export type DCMessageHandler = (msg: DataChannelControlMessage | ArrayBuffer) => void

export class PeerConnection {
  private pc: RTCPeerConnection
  private dc: RTCDataChannel | null = null
  private onDataChannelMessage: DCMessageHandler | null = null
  private onChannelOpen: (() => void) | null = null

  // ICE candidate queue — see "The ICE Candidate Timing Problem" section below
  private iceCandidateQueue: RTCIceCandidateInit[] = []
  private remoteDescSet = false

  constructor(
    private signaling: SignalingClient,
    private role: 'initiator' | 'answerer'
  ) {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    this.setupPCEvents()
  }

  private setupPCEvents() {
    // Trickle ICE: send candidates immediately as they're discovered.
    // Don't wait for all of them — that slows connection time significantly.
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.signaling.send({ type: 'ICE_CANDIDATE', candidate: candidate.toJSON() })
      }
    }

    this.pc.oniceconnectionstatechange = () => {
      console.log('ICE state:', this.pc.iceConnectionState)
      // 'failed' → notify the UI here in production
    }

    // The answerer receives the DataChannel that the initiator created
    this.pc.ondatachannel = ({ channel }) => {
      if (this.role === 'answerer') {
        this.attachDataChannel(channel)
      }
    }
  }

  private attachDataChannel(dc: RTCDataChannel) {
    this.dc = dc

    // binaryType MUST be 'arraybuffer', not 'blob'.
    // arraybuffer gives you bytes synchronously in onmessage.
    // blob is async and requires a .arrayBuffer() call — that breaks your
    // ability to distinguish control messages (strings) from data (binary).
    dc.binaryType = 'arraybuffer'

    dc.onopen = () => {
      console.log('DataChannel open')
      this.onChannelOpen?.()
    }
    dc.onclose = () => console.log('DataChannel closed')
    dc.onmessage = (event) => {
      if (!this.onDataChannelMessage) return
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data) as DataChannelControlMessage
        this.onDataChannelMessage(msg)
      } else {
        this.onDataChannelMessage(event.data as ArrayBuffer)
      }
    }
  }

  // Called by initiator after PEER_JOINED arrives
  async startHandshake() {
    if (this.role !== 'initiator') throw new Error('Only initiator calls startHandshake')

    // Create the DataChannel BEFORE creating the offer.
    // The channel description is embedded in the SDP offer.
    const dc = this.pc.createDataChannel(DATACHANNEL_LABEL, {
      ordered: true,
      // Don't set maxRetransmits or maxPacketLifeTime.
      // Those switch the channel to unreliable mode. File transfer needs
      // reliable delivery — WebRTC handles retransmission internally.
    })
    this.attachDataChannel(dc)

    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    this.signaling.send({ type: 'OFFER', sdp: offer })
  }

  // Called by answerer when OFFER arrives
  async handleOffer(sdp: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp))
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    this.signaling.send({ type: 'ANSWER', sdp: answer })
    await this.drainCandidateQueue()
  }

  // Called by initiator when ANSWER arrives
  async handleAnswer(sdp: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp))
    await this.drainCandidateQueue()
  }

  // Called by both sides as ICE_CANDIDATE messages arrive
  async handleIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.remoteDescSet) {
      // Queue it — remote description not set yet
      this.iceCandidateQueue.push(candidate)
      return
    }
    await this.pc.addIceCandidate(new RTCIceCandidate(candidate))
  }

  // Drain queued candidates after remote description is set
  private async drainCandidateQueue() {
    this.remoteDescSet = true
    for (const c of this.iceCandidateQueue) {
      await this.pc.addIceCandidate(new RTCIceCandidate(c))
    }
    this.iceCandidateQueue = []
  }

  getDataChannel(): RTCDataChannel | null {
    return this.dc
  }

  onOpen(cb: () => void) {
    this.onChannelOpen = cb
    // If the channel is already open (race condition), fire immediately
    if (this.dc?.readyState === 'open') cb()
  }

  onMessage(cb: DCMessageHandler) {
    this.onDataChannelMessage = cb
  }

  close() {
    this.dc?.close()
    this.pc.close()
  }
}
```

---

### `fileSender.ts` — Chunking + Backpressure

```ts
// client/src/lib/fileSender.ts

const CHUNK_SIZE = 64 * 1024              // 64KB per chunk
const BUFFER_PAUSE_THRESHOLD  = 1 * 1024 * 1024   // pause when buffer > 1MB
const BUFFER_RESUME_THRESHOLD = 256 * 1024         // resume when buffer < 256KB

function waitForBufferDrain(dc: RTCDataChannel): Promise<void> {
  // The browser fires bufferedamountlow when bufferedAmount drops below
  // dc.bufferedAmountLowThreshold. Set that threshold and wait.
  return new Promise((resolve) => {
    dc.bufferedAmountLowThreshold = BUFFER_RESUME_THRESHOLD
    dc.onbufferedamountlow = () => {
      dc.onbufferedamountlow = null
      resolve()
    }
  })
}

export interface SendProgress {
  bytesSent: number
  totalBytes: number
  percent: number       // 0–100
  chunksTotal: number
  chunksSent: number
}

export async function sendFile(
  dc: RTCDataChannel,
  file: File,
  onProgress: (p: SendProgress) => void,
  signal?: AbortSignal  // optional — lets you cancel mid-transfer
): Promise<void> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

  // Step 1: Send metadata so the receiver can set up StreamSaver before data arrives
  dc.send(
    JSON.stringify({
      type: 'FILE_START',
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      totalChunks,
    })
  )

  let offset = 0
  let chunksSent = 0

  // Step 2: Read and send one chunk at a time
  while (offset < file.size) {
    if (signal?.aborted) throw new DOMException('Transfer aborted', 'AbortError')

    // Backpressure check — don't overwhelm the DataChannel buffer
    if (dc.bufferedAmount > BUFFER_PAUSE_THRESHOLD) {
      await waitForBufferDrain(dc)
    }

    // file.slice().arrayBuffer() reads only this 64KB window from disk.
    // The full 2GB file is never in memory at once.
    const end = Math.min(offset + CHUNK_SIZE, file.size)
    const chunk = await file.slice(offset, end).arrayBuffer()
    dc.send(chunk)

    offset = end
    chunksSent++

    onProgress({
      bytesSent: offset,
      totalBytes: file.size,
      percent: Math.round((offset / file.size) * 100),
      chunksTotal: totalChunks,
      chunksSent,
    })
  }

  // Step 3: Signal end of file
  dc.send(JSON.stringify({ type: 'FILE_END', name: file.name }))
}
```

---

### `fileReceiver.ts` — StreamSaver + Chunk Writing

StreamSaver uses a service worker to intercept a fetch and pipe chunks into a browser download. Chunks are written directly to disk as they arrive — memory usage stays flat for any file size.

```ts
// client/src/lib/fileReceiver.ts
import streamSaver from 'streamsaver'

export interface ReceiveProgress {
  bytesReceived: number
  totalBytes: number
  percent: number
  fileName: string
}

export class FileReceiver {
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private totalBytes = 0
  private bytesReceived = 0
  private fileName = ''
  private onProgress: ((p: ReceiveProgress) => void) | null = null
  private onComplete: ((fileName: string) => void) | null = null

  onReceiveProgress(cb: (p: ReceiveProgress) => void) {
    this.onProgress = cb
  }

  onReceiveComplete(cb: (fileName: string) => void) {
    this.onComplete = cb
  }

  // Call this for every DataChannel message.
  // Returns true if the message was file-related, false otherwise.
  handleMessage(data: string | ArrayBuffer): boolean {
    if (typeof data === 'string') {
      const msg = JSON.parse(data) as
        | { type: 'FILE_START'; name: string; size: number; mimeType: string }
        | { type: 'FILE_END'; name: string }

      if (msg.type === 'FILE_START') {
        this.fileName = msg.name
        this.totalBytes = msg.size
        this.bytesReceived = 0

        // Open a writable stream that goes directly to disk via StreamSaver.
        // This is why memory usage stays flat — chunks stream out as they arrive.
        const fileStream = streamSaver.createWriteStream(msg.name, {
          size: msg.size,
        })
        this.writer = fileStream.getWriter()
        return true
      }

      if (msg.type === 'FILE_END') {
        this.writer?.close()
        this.writer = null
        this.onComplete?.(msg.name)
        return true
      }

    } else {
      // ArrayBuffer chunk
      if (!this.writer) return false

      const chunk = new Uint8Array(data)
      // write() is async but we don't await it — WritableStream has its own internal queue
      this.writer.write(chunk)

      this.bytesReceived += chunk.byteLength
      this.onProgress?.({
        bytesReceived: this.bytesReceived,
        totalBytes: this.totalBytes,
        percent: Math.round((this.bytesReceived / this.totalBytes) * 100),
        fileName: this.fileName,
      })
      return true
    }

    return false
  }

  // Call this if the peer disconnects mid-transfer
  abort() {
    this.writer?.abort()
    this.writer = null
  }
}
```

---

## Frontend — Next.js

**Setup:**
```bash
npx create-next-app@latest client --typescript --app-dir false
# Use pages/ router — simpler for this project

npm install streamsaver @types/streamsaver
```

---

### `_app.tsx` — Register StreamSaver Service Worker

StreamSaver needs a service worker to intercept the download. The `mitm.html` file must be served from your domain.

```tsx
// client/src/pages/_app.tsx
import type { AppProps } from 'next/app'
import { useEffect } from 'react'
import streamSaver from 'streamsaver'

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    streamSaver.mitm = '/mitm.html'
  }, [])

  return <Component {...pageProps} />
}
```

After installing, copy `node_modules/streamsaver/mitm.html` into `public/mitm.html`. That's the only StreamSaver setup required.

---

### `DropZone.tsx` — Drag and Drop + Click to Select

```tsx
// client/src/components/DropZone.tsx
import { useRef, useState, DragEvent, ChangeEvent } from 'react'

interface Props {
  onFileSelected: (file: File) => void
  disabled?: boolean
}

export function DropZone({ onFileSelected, disabled }: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault() // Required — without this the browser won't fire drop
    e.stopPropagation()
    if (!disabled) setIsDragging(true)
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    // Only clear dragging state if leaving the actual drop zone, not a child element
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (disabled) return
    const file = e.dataTransfer.files[0]
    if (file) onFileSelected(file)
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onFileSelected(file)
    e.target.value = '' // reset so the same file can be re-selected
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      style={{
        border: `2px dashed ${isDragging ? '#6366f1' : '#ccc'}`,
        borderRadius: 12,
        padding: '48px 32px',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: isDragging ? '#eef2ff' : 'transparent',
        transition: 'all 0.15s',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <p style={{ margin: 0, fontSize: 16 }}>
        {isDragging ? 'Drop it!' : 'Drag a file here, or click to browse'}
      </p>
      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
    </div>
  )
}
```

---

### `session/[code].tsx` — The Session Page

This is where everything wires together. A `SessionPhase` state machine drives the whole UI.

```tsx
// client/src/pages/session/[code].tsx
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { SignalingClient } from '@/lib/signalingClient'
import { PeerConnection } from '@/lib/peerConnection'
import { sendFile, SendProgress } from '@/lib/fileSender'
import { FileReceiver, ReceiveProgress } from '@/lib/fileReceiver'
import { ServerMessage, TransferState } from '@/lib/types'
import { DropZone } from '@/components/DropZone'

type SessionPhase =
  | 'waiting_for_peer'   // created session, showing code, waiting
  | 'negotiating'        // both in room, WebRTC handshake happening
  | 'connected'          // DataChannel open, ready to transfer
  | 'busy'               // mid-transfer (sending or receiving)
  | 'peer_disconnected'

export default function SessionPage() {
  const router = useRouter()
  const code = router.query.code as string
  const isInitiator = router.query.role === 'initiator' // set by index.tsx on navigate

  const [phase, setPhase] = useState<SessionPhase>('waiting_for_peer')
  const [transfer, setTransfer] = useState<TransferState>({ phase: 'idle' })

  // Refs hold connection objects — we don't want re-renders to recreate them
  const signalingRef = useRef<SignalingClient | null>(null)
  const peerRef = useRef<PeerConnection | null>(null)
  const receiverRef = useRef<FileReceiver>(new FileReceiver())

  useEffect(() => {
    if (!code) return

    const signaling = new SignalingClient('ws://localhost:8080')
    signalingRef.current = signaling

    const role = isInitiator ? 'initiator' : 'answerer'
    const peer = new PeerConnection(signaling, role)
    peerRef.current = peer

    const receiver = receiverRef.current

    receiver.onReceiveProgress((p: ReceiveProgress) => {
      setTransfer({ phase: 'receiving', fileName: p.fileName, progress: p.percent / 100 })
    })

    receiver.onReceiveComplete((fileName: string) => {
      setTransfer({ phase: 'done', fileName, direction: 'received' })
      setPhase('connected')
    })

    // All incoming DataChannel messages go through the receiver
    peer.onMessage((msg) => {
      receiver.handleMessage(typeof msg === 'string' ? msg : msg as ArrayBuffer)
    })

    peer.onOpen(() => {
      setPhase('connected')
    })

    const unsub = signaling.onMessage(async (msg: ServerMessage) => {
      switch (msg.type) {
        case 'PEER_JOINED':
          // Fires on the initiator when the second user joins.
          // Start the WebRTC handshake now.
          setPhase('negotiating')
          await peer.startHandshake()
          break

        case 'SESSION_JOINED':
          // Fires on the answerer — they're in. Waiting for OFFER.
          setPhase('negotiating')
          break

        case 'OFFER':
          await peer.handleOffer(msg.sdp)
          break

        case 'ANSWER':
          await peer.handleAnswer(msg.sdp)
          break

        case 'ICE_CANDIDATE':
          await peer.handleIceCandidate(msg.candidate)
          break

        case 'PEER_DISCONNECTED':
          receiver.abort()
          setPhase('peer_disconnected')
          peer.close()
          break
      }
    })

    return () => {
      unsub()
      peer.close()
      signaling.close()
    }
  }, [code, isInitiator])

  async function handleFileSelected(file: File) {
    const dc = peerRef.current?.getDataChannel()
    if (!dc || dc.readyState !== 'open') return

    setPhase('busy')
    setTransfer({ phase: 'sending', fileName: file.name, progress: 0 })

    try {
      await sendFile(dc, file, (p: SendProgress) => {
        setTransfer({ phase: 'sending', fileName: file.name, progress: p.percent / 100 })
      })
      setTransfer({ phase: 'done', fileName: file.name, direction: 'sent' })
    } catch (err) {
      console.error('Send failed:', err)
    } finally {
      setPhase('connected')
    }
  }

  return (
    <main style={{ maxWidth: 600, margin: '0 auto', padding: 32 }}>
      <h1 style={{ fontSize: 24, fontWeight: 500 }}>Session: {code}</h1>

      {phase === 'waiting_for_peer' && (
        <p>Share this code with the other person: <strong>{code}</strong></p>
      )}
      {phase === 'negotiating' && (
        <p>Connecting...</p>
      )}
      {phase === 'peer_disconnected' && (
        <p>The other person disconnected.</p>
      )}

      {(phase === 'connected' || phase === 'busy') && (
        <>
          <p style={{ color: '#16a34a' }}>Connected — either side can send files</p>

          <DropZone onFileSelected={handleFileSelected} disabled={phase === 'busy'} />

          {transfer.phase === 'sending' && (
            <div style={{ marginTop: 16 }}>
              <p>Sending {transfer.fileName}...</p>
              <progress value={transfer.progress} max={1} style={{ width: '100%' }} />
              <p>{Math.round(transfer.progress * 100)}%</p>
            </div>
          )}
          {transfer.phase === 'receiving' && (
            <div style={{ marginTop: 16 }}>
              <p>Receiving {transfer.fileName}...</p>
              <progress value={transfer.progress} max={1} style={{ width: '100%' }} />
              <p>{Math.round(transfer.progress * 100)}%</p>
            </div>
          )}
          {transfer.phase === 'done' && (
            <p style={{ color: '#16a34a', marginTop: 16 }}>
              {transfer.direction === 'sent'
                ? `Sent ${transfer.fileName}`
                : `Downloaded ${transfer.fileName}`}
            </p>
          )}
        </>
      )}
    </main>
  )
}
```

---

### `index.tsx` — Home Page

```tsx
// client/src/pages/index.tsx
import { useState } from 'react'
import { useRouter } from 'next/router'
import { SignalingClient } from '@/lib/signalingClient'

export default function Home() {
  const router = useRouter()
  const [joinCode, setJoinCode] = useState('')
  const [error, setError] = useState('')

  function handleCreate() {
    const signaling = new SignalingClient('ws://localhost:8080')
    const unsub = signaling.onMessage((msg) => {
      if (msg.type === 'SESSION_CREATED') {
        unsub()
        signaling.close()
        // role=initiator tells the session page to start the WebRTC handshake
        router.push(`/session/${msg.code}?role=initiator`)
      }
    })
    signaling.send({ type: 'CREATE_SESSION' })
  }

  function handleJoin() {
    const code = joinCode.trim().toUpperCase()
    if (code.length !== 5) {
      setError('Enter a 5-character code')
      return
    }

    const signaling = new SignalingClient('ws://localhost:8080')
    const unsub = signaling.onMessage((msg) => {
      if (msg.type === 'SESSION_JOINED') {
        unsub()
        signaling.close()
        router.push(`/session/${msg.code}?role=answerer`)
      }
      if (msg.type === 'SESSION_NOT_FOUND') {
        setError('Code not found')
        signaling.close()
      }
      if (msg.type === 'SESSION_FULL') {
        setError('Session already has two people')
        signaling.close()
      }
    })
    signaling.send({ type: 'JOIN_SESSION', code })
  }

  return (
    <main style={{ maxWidth: 480, margin: '80px auto', padding: 32 }}>
      <h1 style={{ fontSize: 28, fontWeight: 500, marginBottom: 32 }}>Chunx</h1>

      <button
        onClick={handleCreate}
        style={{ display: 'block', width: '100%', padding: '12px', marginBottom: 24 }}
      >
        Create session
      </button>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={joinCode}
          onChange={e => { setJoinCode(e.target.value); setError('') }}
          placeholder="Enter code"
          maxLength={5}
          style={{ flex: 1, padding: 12, textTransform: 'uppercase', letterSpacing: 4 }}
        />
        <button onClick={handleJoin} style={{ padding: '12px 24px' }}>Join</button>
      </div>

      {error && <p style={{ color: '#dc2626', marginTop: 8 }}>{error}</p>}
    </main>
  )
}
```

---

## The ICE Candidate Timing Problem

ICE candidates can arrive from the server before `setRemoteDescription` has been called on the receiver. When that happens, `addIceCandidate` throws. The fix is already integrated into `peerConnection.ts` above via a candidate queue:

```ts
// Add to PeerConnection class
private iceCandidateQueue: RTCIceCandidateInit[] = []
private remoteDescSet = false

async handleIceCandidate(candidate: RTCIceCandidateInit) {
  if (!this.remoteDescSet) {
    this.iceCandidateQueue.push(candidate)
    return
  }
  await this.pc.addIceCandidate(new RTCIceCandidate(candidate))
}

private async drainCandidateQueue() {
  this.remoteDescSet = true
  for (const c of this.iceCandidateQueue) {
    await this.pc.addIceCandidate(new RTCIceCandidate(c))
  }
  this.iceCandidateQueue = []
}
```

`drainCandidateQueue()` is called at the end of both `handleOffer` and `handleAnswer`. Without this, you'll see silent connection failures on fast networks where ICE candidates race ahead of the SDP exchange.

---

## STUN / TURN

For now, only free public STUN servers are used. This works for most networks but will fail when both peers are behind symmetric NAT (common in corporate/mobile networks).

| Server type | Cost | When needed |
|---|---|---|
| STUN (Google) | Free | Most cases — helps peers discover public IPs |
| TURN | Paid (bandwidth) | Symmetric NAT, strict firewalls |

TURN is a future improvement — not needed for the initial build.

---

## Quick Reference — What Goes Where

| Problem | Tool | Location |
|---|---|---|
| Real-time session setup | WebSocket + discriminated union protocol | `server/` |
| P2P connection | `RTCPeerConnection` | `peerConnection.ts` |
| File chunking | `File.slice().arrayBuffer()` | `fileSender.ts` |
| Buffer overflow prevention | `bufferedAmount` + `bufferedamountlow` event | `fileSender.ts` |
| Writing to disk without RAM | StreamSaver.js | `fileReceiver.ts` |
| Drag and drop | Native drag events | `DropZone.tsx` |
| Bilateral transfer | DataChannel is already bidirectional — both sides call `.send()` | `session/[code].tsx` |
| Dead connection cleanup | Manual ping/pong heartbeat | `server/index.ts` |
| ICE candidate race condition | Candidate queue + drain after `setRemoteDescription` | `peerConnection.ts` |

---

## Future Improvements

- **TURN server** — for users on symmetric NAT / strict firewalls
- **Transfer resume** — if connection drops mid-file
- **Multiple files** — queue and send sequentially
- **Multi-peer** — more than 2 users per session
- **Encryption** — additional end-to-end layer on top of WebRTC's built-in DTLS