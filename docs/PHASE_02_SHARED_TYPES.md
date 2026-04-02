# Phase 2: Shared Types

This phase defines all the TypeScript types used throughout the application. Getting the types right first makes the rest of the implementation much smoother.

---

## 2.1 Create the Types File

**File:** `client/src/lib/types.ts`

Create this file with the following content:

```typescript
// client/src/lib/types.ts

// ============================================================================
// SIGNALING MESSAGES (over WebSocket)
// These match the server's types exactly
// ============================================================================

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
  | { type: 'SESSION_JOINED'; code: string }
  | { type: 'PEER_JOINED' }
  | { type: 'SESSION_NOT_FOUND' }
  | { type: 'SESSION_FULL' }
  | { type: 'OFFER'; sdp: RTCSessionDescriptionInit }
  | { type: 'ANSWER'; sdp: RTCSessionDescriptionInit }
  | { type: 'ICE_CANDIDATE'; candidate: RTCIceCandidateInit }
  | { type: 'PEER_DISCONNECTED' }
  | { type: 'PING' }

// ============================================================================
// DATA CHANNEL MESSAGES (over WebRTC P2P connection)
// These are exchanged directly between peers after connection is established
// ============================================================================

export type DataChannelControlMessage =
  | {
      type: 'FILE_START'
      name: string
      size: number           // bytes
      mimeType: string
      totalChunks: number
    }
  | { type: 'FILE_END'; name: string }

// ============================================================================
// TRANSFER STATE
// This drives the UI state in the session page
// ============================================================================

export type TransferState =
  | { phase: 'idle' }
  | { phase: 'sending'; fileName: string; progress: number }  // 0–1
  | { phase: 'receiving'; fileName: string; progress: number }  // 0–1
  | { phase: 'done'; fileName: string; direction: 'sent' | 'received' }

// ============================================================================
// PROGRESS TYPES
// Used by fileSender and fileReceiver to report progress
// ============================================================================

export interface SendProgress {
  bytesSent: number
  totalBytes: number
  percent: number           // 0–100
  chunksTotal: number
  chunksSent: number
}

export interface ReceiveProgress {
  bytesReceived: number
  totalBytes: number
  percent: number
  fileName: string
}
```

---

## 2.2 Understanding the Type Categories

### Signaling Messages (WebSocket)

These travel through the signaling server:

```
Client ──[ClientMessage]──> Server ──[ServerMessage]──> Client
```

**Key points:**
- `CREATE_SESSION` / `JOIN_SESSION`: Session management
- `OFFER` / `ANSWER` / `ICE_CANDIDATE`: WebRTC handshake (server just relays these)
- `PING` / `PONG`: Heartbeat to detect dead connections

### Data Channel Messages (P2P)

These travel directly between peers **after** WebRTC connection is established:

```
Peer A ──[DataChannelControlMessage | ArrayBuffer]──> Peer B
```

**Key points:**
- `FILE_START`: Metadata sent before file chunks (name, size, type)
- `FILE_END`: Signal that all chunks have been sent
- `ArrayBuffer`: Raw binary chunk data (not JSON)

### Transfer State

This is used internally in the session page to drive the UI:

```typescript
// Examples:
{ phase: 'idle' }                              // Nothing happening
{ phase: 'sending', fileName: 'video.mp4', progress: 0.45 }  // 45% sent
{ phase: 'receiving', fileName: 'video.mp4', progress: 0.72 } // 72% received
{ phase: 'done', fileName: 'video.mp4', direction: 'sent' }   // Complete
```

---

## 2.3 Why This Structure Matters

**Discriminated Unions:** All message types use discriminated unions (the `type` field). This allows TypeScript to narrow types automatically:

```typescript
if (msg.type === 'SESSION_CREATED') {
  // TypeScript knows msg.code exists here
  console.log(msg.code)
}
```

**Separation of Concerns:**
- Signaling messages ≠ Data channel messages
- They serve different purposes and travel different paths
- Keeping them separate prevents confusion

---

## 2.4 Verify TypeScript Configuration

Make sure your `client/tsconfig.json` has `strict: true`:

```json
{
  "compilerOptions": {
    "strict": true
  }
}
```

This ensures type safety throughout the project.

---

## 2.5 Checklist

Before moving to Phase 3, verify:

- [ ] `client/src/lib/types.ts` exists with all types above
- [ ] No TypeScript errors in the file
- [ ] You understand the difference between signaling messages and data channel messages
- [ ] You understand what each type category is used for

---

**Next Phase:** [Phase 3 - Signaling Client](./PHASE_03_SIGNALING_CLIENT.md)
