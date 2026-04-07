# Chunx — Working Codebase Structure

## What It Is
A peer-to-peer file sharing web app. Two users open the site, one creates a session and shares a 5-character code, the other joins. Files transfer directly via WebRTC DataChannel — the server never sees file data.

## Stack
- **Frontend:** Next.js (Pages Router) + TypeScript + TailwindCSS
- **Backend:** Node.js + `ws` library (port 8081)
- **P2P:** WebRTC `RTCPeerConnection` + `RTCDataChannel`
- **File reading:** Browser File API (`file.slice().arrayBuffer()`)
- **File writing:** StreamSaver.js (streams chunks to disk via service worker)
- **Network traversal:** Google STUN servers only (no TURN)

## Project Structure
```
chunx/
├── signaling-server/          ← Node.js signaling server
│   └── src/
│       ├── index.ts           ← HTTP + WebSocket server, heartbeat every 30s
│       ├── types.ts           ← Discriminated union: ClientMessage / ServerMessage + send() helper
│       ├── sessionManager.ts  ← In-memory session map, code generation, peer lookup/removal
│       └── relay.ts           ← Message router: CREATE_SESSION, JOIN_SESSION, relay OFFER/ANSWER/ICE
│
└── client/                    ← Next.js app
    ├── lib/
    │   ├── types.ts           ← Shared types: ClientMessage, ServerMessage,
    │   │                        DataChannelControlMessage, TransferState, SendProgress, ReceiveProgress
    │   ├── signalingClient.ts ← Typed WebSocket wrapper (connects to ws://127.0.0.1:8081)
    │   ├── peerConnection.ts  ← RTCPeerConnection wrapper: SDP handshake, ICE exchange (with queuing),
    │   │                        DataChannel setup (binaryType='arraybuffer', ordered=true)
    │   ├── fileSender.ts      ← Reads file in 64KB chunks via file.slice().arrayBuffer(),
    │   │                        sends over DataChannel with backpressure (pause >1MB, resume <256KB),
    │   │                        sends FILE_START metadata then FILE_END
    │   └── fileReceiver.ts    ← Receives messages via message queue (sequential processing).
    │                            Uses StreamSaver.createWriteStream() to write chunks to disk.
    │
    ├── components/
    │   ├── DropZone.tsx       ← Drag-and-drop + click-to-browse file upload zone
    │   ├── ProgressBar.tsx    ← Progress bar component (currently unused)
    │   └── Modal.tsx          ← Modal dialog (shown when multiple files are dropped)
    │
    ├── pages/
    │   ├── _app.tsx           ← App wrapper, dynamic imports StreamSaver, sets mitm='/mitm.html'
    │   ├── _document.tsx      ← Standard Next.js document shell
    │   ├── index.tsx          ← Home page: Create Session + Join Session form
    │   └── session/[code].tsx ← Session page: full WebRTC + file transfer UI
    │
    └── public/
        └── mitm.html          ← StreamSaver's service worker bridge (copied from node_modules)
```

## Data Flow — Sender Side
1. User selects/drops file → `handleFileSelected(file)` in session page
2. Session page calls `sendFile({ dc, file, onProgress })`
3. `sendFile` sends `FILE_START` JSON message over DataChannel (metadata: name, size, mimeType, totalChunks)
4. Reads file in 64KB chunks via `file.slice(offset, end).arrayBuffer()`
5. Each chunk sent as raw ArrayBuffer over DataChannel (`dc.send(chunk)`)
6. Backpressure: pauses if `dc.bufferedAmount > 1MB`, resumes on `bufferedamountlow` event
7. After all chunks sent, sends `FILE_END` JSON message

## Data Flow — Receiver Side
1. DataChannel messages arrive → `peer.onMessage(msg)` → `receiver.handleMessage(msg)`
2. `FileReceiver` uses a **sequential message queue** — each message fully processes before the next
3. `FILE_START` → lazy-loads StreamSaver → `createWriteStream(fileName, { size })` → `getWriter()`
4. ArrayBuffer chunks → `writer.write(chunk)` (fire-and-forget, not awaited)
5. `FILE_END` → `await writer.ready` → `await writer.close()` → triggers `onReceiveComplete`

## WebRTC Handshake
- Session creator (initiator) creates DataChannel, calls `createOffer`, sends OFFER via signaling
- Joiner (answerer) receives OFFER, calls `createAnswer`, sends ANSWER via signaling
- Both sides exchange ICE candidates (trickle ICE, with queuing until remote description is set)
- DataChannel opens → file transfer can begin

## Signaling Protocol
- Client→Server: `CREATE_SESSION`, `JOIN_SESSION`, `OFFER`, `ANSWER`, `ICE_CANDIDATE`, `PONG`
- Server→Client: `SESSION_CREATED`, `SESSION_JOINED`, `PEER_JOINED`, `SESSION_NOT_FOUND`, `SESSION_FULL`, `OFFER`, `ANSWER`, `ICE_CANDIDATE`, `PEER_DISCONNECTED`, `PING`
- DataChannel: `FILE_START`, `FILE_END`, ArrayBuffer (binary chunks)

## UI State
- `SessionPhase`: `waiting_for_peer` → `negotiating` → `connected` / `peer_disconnected` / `busy`
- `TransferState`: `{ phase: 'idle' | 'sending' | 'receiving' | 'done' }` with fileName, progress, direction
- DropZone disabled when `phase === 'busy'` (either sending or receiving)
- Multiple file drop shows a Modal warning

## Key Constraints
- Max 2 peers per session (unidirectional per transfer, but either side can initiate)
- No TURN server (STUN only)
- File never stored in memory — streamed via File API + StreamSaver
- StreamSaver requires service worker — uses `mitm.html` from local domain
