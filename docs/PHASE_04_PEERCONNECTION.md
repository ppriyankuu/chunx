# Phase 4: PeerConnection (WebRTC)

This phase creates the WebRTC connection layer. This is the most complex part of the project — it handles the P2P connection setup, ICE candidate management, and DataChannel communication.

---

## 4.1 Create the PeerConnection Class

**File:** `client/src/lib/peerConnection.ts`

Create this file:

```typescript
// client/src/lib/peerConnection.ts

import { SignalingClient } from './signalingClient'
import { DataChannelControlMessage } from './types'

// ============================================================================
// CONFIGURATION
// ============================================================================

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

const DATACHANNEL_LABEL = 'chunx-transfer'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type DCMessageHandler = (msg: DataChannelControlMessage | ArrayBuffer) => void

// ============================================================================
// CLASS
// ============================================================================

export class PeerConnection {
  private pc: RTCPeerConnection
  private dc: RTCDataChannel | null = null
  private onDataChannelMessage: DCMessageHandler | null = null
  private onChannelOpen: (() => void) | null = null

  // ICE candidate queue — handles the timing problem where candidates arrive
  // before setRemoteDescription has been called
  private iceCandidateQueue: RTCIceCandidateInit[] = []
  private remoteDescSet = false

  constructor(
    private signaling: SignalingClient,
    private role: 'initiator' | 'answerer'
  ) {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    this.setupPCEvents()
  }

  // ============================================================================
  // PRIVATE: SETUP WEBRTC EVENT LISTENERS
  // ============================================================================

  private setupPCEvents() {
    // --- ICE Candidate Handling (Trickle ICE) ---
    // Send candidates immediately as they're discovered (don't wait for all)
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.signaling.send({ 
          type: 'ICE_CANDIDATE', 
          candidate: candidate.toJSON() 
        })
      }
    }

    // Monitor ICE connection state for debugging
    this.pc.oniceconnectionstatechange = () => {
      console.log('ICE state:', this.pc.iceConnectionState)
      // In production, you'd handle 'failed' or 'disconnected' states here
    }

    // --- DataChannel Handling (Answerer only) ---
    // The initiator creates the DataChannel, the answerer receives it here
    this.pc.ondatachannel = ({ channel }) => {
      if (this.role === 'answerer') {
        this.attachDataChannel(channel)
      }
    }
  }

  // ============================================================================
  // PRIVATE: ATTACH DATACHANNEL HANDLERS
  // ============================================================================

  private attachDataChannel(dc: RTCDataChannel) {
    this.dc = dc

    // CRITICAL: Must be 'arraybuffer' not 'blob'
    // - arraybuffer: gives you bytes synchronously in onmessage
    // - blob: async, requires .arrayBuffer() call — breaks control/data distinction
    dc.binaryType = 'arraybuffer'

    dc.onopen = () => {
      console.log('DataChannel open')
      this.onChannelOpen?.()
    }

    dc.onclose = () => {
      console.log('DataChannel closed')
    }

    dc.onmessage = (event) => {
      if (!this.onDataChannelMessage) return
      
      if (typeof event.data === 'string') {
        // Control message (JSON)
        const msg = JSON.parse(event.data) as DataChannelControlMessage
        this.onDataChannelMessage(msg)
      } else {
        // Binary data (ArrayBuffer chunk)
        this.onDataChannelMessage(event.data as ArrayBuffer)
      }
    }
  }

  // ============================================================================
  // PUBLIC: INITIATOR METHODS (called by session creator)
  // ============================================================================

  /**
   * Start the WebRTC handshake (initiator only)
   * Call this after receiving PEER_JOINED from signaling server
   */
  async startHandshake() {
    if (this.role !== 'initiator') {
      throw new Error('Only initiator calls startHandshake')
    }

    // Create DataChannel BEFORE creating offer
    // The channel description is embedded in the SDP offer
    const dc = this.pc.createDataChannel(DATACHANNEL_LABEL, {
      ordered: true,
      // Don't set maxRetransmits or maxPacketLifeTime
      // Those switch to unreliable mode — we need reliable for file transfer
    })
    this.attachDataChannel(dc)

    // Create and send offer
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    this.signaling.send({ type: 'OFFER', sdp: offer })
  }

  // ============================================================================
  // PUBLIC: ANSWERER METHODS (called by session joiner)
  // ============================================================================

  /**
   * Handle an incoming offer (answerer only)
   * Call this when receiving OFFER from signaling server
   */
  async handleOffer(sdp: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp))
    
    // Create and send answer
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    this.signaling.send({ type: 'ANSWER', sdp: answer })
    
    // Drain any queued ICE candidates
    await this.drainCandidateQueue()
  }

  // ============================================================================
  // PUBLIC: BOTH SIDES (called when messages arrive from signaling)
  // ============================================================================

  /**
   * Handle an incoming answer (initiator only)
   * Call this when receiving ANSWER from signaling server
   */
  async handleAnswer(sdp: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp))
    await this.drainCandidateQueue()
  }

  /**
   * Handle an incoming ICE candidate (both sides)
   * Call this when receiving ICE_CANDIDATE from signaling server
   */
  async handleIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.remoteDescSet) {
      // Queue it — remote description not set yet
      this.iceCandidateQueue.push(candidate)
      return
    }
    await this.pc.addIceCandidate(new RTCIceCandidate(candidate))
  }

  // ============================================================================
  // PRIVATE: ICE CANDIDATE QUEUE MANAGEMENT
  // ============================================================================

  /**
   * Drain queued ICE candidates after remote description is set
   * 
   * THE PROBLEM: ICE candidates can arrive from the server before 
   * setRemoteDescription has been called. When that happens, addIceCandidate throws.
   * 
   * THE SOLUTION: Queue candidates that arrive early, then drain them
   * after setRemoteDescription completes.
   */
  private async drainCandidateQueue() {
    this.remoteDescSet = true
    for (const c of this.iceCandidateQueue) {
      await this.pc.addIceCandidate(new RTCIceCandidate(c))
    }
    this.iceCandidateQueue = []
  }

  // ============================================================================
  // PUBLIC: DATACHANNEL ACCESS
  // ============================================================================

  /**
   * Get the DataChannel for sending file data
   */
  getDataChannel(): RTCDataChannel | null {
    return this.dc
  }

  /**
   * Subscribe to DataChannel open event
   */
  onOpen(cb: () => void) {
    this.onChannelOpen = cb
    // If already open (race condition), fire immediately
    if (this.dc?.readyState === 'open') {
      cb()
    }
  }

  /**
   * Subscribe to DataChannel messages
   */
  onMessage(cb: DCMessageHandler) {
    this.onDataChannelMessage = cb
  }

  // ============================================================================
  // PUBLIC: CLEANUP
  // ============================================================================

  /**
   * Close the DataChannel and RTCPeerConnection
   */
  close() {
    this.dc?.close()
    this.pc.close()
  }
}
```

---

## 4.2 Understanding the Roles

### Initiator (Session Creator)

The person who created the session:

1. Calls `startHandshake()` after receiving `PEER_JOINED`
2. Creates the DataChannel
3. Sends the OFFER
4. Receives ANSWER
5. Both sides add ICE candidates

### Answerer (Session Joiner)

The person who joined with a code:

1. Waits for OFFER (comes after joining)
2. Calls `handleOffer()` when OFFER arrives
3. Sends ANSWER
4. Receives the DataChannel via `ondatachannel`
5. Both sides add ICE candidates

```
Initiator                          Answerer
   │                                   │
   │───[createDataChannel]────────────>│
   │───[createOffer]──────────────────>│
   │───[setLocalDescription(offer)]───>│
   │                                   │
   │───────[OFFER via signaling]──────>│
   │                                   │
   │                          [setRemoteDescription(offer)]
   │                          [createAnswer]
   │                          [setLocalDescription(answer)]
   │                                   │
   │<──────[ANSWER via signaling]──────│
   │                                   │
   │[setRemoteDescription(answer)]     │
   │                                   │
   │<═══════════ DataChannel Open ════════>│
   │                                   │
```

---

## 4.3 The ICE Candidate Timing Problem

This is a **critical** part that often causes silent failures.

### The Problem

ICE candidates (network route information) can arrive **before** `setRemoteDescription` has been called. When this happens:

```typescript
// This THROWS if remote description isn't set yet
await pc.addIceCandidate(candidate)  // ❌ Error!
```

This happens on fast networks where ICE candidates race ahead of the SDP exchange.

### The Solution

Queue candidates that arrive early, then drain them after the remote description is set:

```typescript
// In handleIceCandidate:
if (!this.remoteDescSet) {
  this.iceCandidateQueue.push(candidate)  // Queue it
  return
}
await this.pc.addIceCandidate(candidate)  // Add it normally

// In handleOffer/handleAnswer (after setRemoteDescription):
await this.drainCandidateQueue()  // Process queued candidates
```

---

## 4.4 Key Configuration Details

### ICE Servers

```typescript
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]
```

- Uses Google's free STUN servers
- STUN helps discover public IP addresses for direct connection
- No TURN server (relay) — this means some networks may fail to connect

### DataChannel Label

```typescript
const DATACHANNEL_LABEL = 'chunx-transfer'
```

- Both sides must use the same label
- The answerer receives the channel with this label via `ondatachannel`

### Binary Type

```typescript
dc.binaryType = 'arraybuffer'
```

- **Must be 'arraybuffer'**, not 'blob'
- `arraybuffer`: synchronous access to bytes in `onmessage`
- `blob`: asynchronous, requires `.arrayBuffer()` call
- Using 'blob' breaks the ability to distinguish control messages from data

### Reliable Mode

```typescript
const dc = this.pc.createDataChannel(DATACHANNEL_LABEL, {
  ordered: true,
  // Don't set maxRetransmits or maxPacketLifeTime
})
```

- Default is reliable mode (guarantees delivery)
- Setting `maxRetransmits` or `maxPacketLifeTime` switches to unreliable mode
- File transfer needs reliable delivery

---

## 4.5 Event Flow Summary

### Initiator Side

```
1. Constructor → Creates RTCPeerConnection
2. startHandshake() → Creates DataChannel, sends OFFER
3. handleAnswer() → Sets remote description, drains ICE queue
4. handleIceCandidate() → Adds candidates (or queues if early)
5. onopen → DataChannel ready for file transfer
```

### Answerer Side

```
1. Constructor → Creates RTCPeerConnection
2. handleOffer() → Sets remote description, sends ANSWER, drains ICE queue
3. ondatachannel → Receives DataChannel from initiator
4. handleIceCandidate() → Adds candidates (or queues if early)
5. onopen → DataChannel ready for file transfer
```

---

## 4.6 Common Mistakes to Avoid

❌ **Creating DataChannel in the answerer:**
```typescript
// WRONG - only initiator creates the DataChannel
const dc = this.pc.createDataChannel(...)
```

✅ **Only initiator creates it:**
```typescript
// CORRECT - answerer receives it via ondatachannel
this.pc.ondatachannel = ({ channel }) => {
  this.attachDataChannel(channel)
}
```

❌ **Using blob binaryType:**
```typescript
// WRONG - breaks synchronous message handling
dc.binaryType = 'blob'
```

✅ **Use arraybuffer:**
```typescript
// CORRECT - gives direct access to bytes
dc.binaryType = 'arraybuffer'
```

❌ **Adding ICE candidates before remote description:**
```typescript
// WRONG - can throw error
await this.pc.addIceCandidate(candidate)
```

✅ **Queue early candidates:**
```typescript
// CORRECT - handles race condition
if (!this.remoteDescSet) {
  this.iceCandidateQueue.push(candidate)
} else {
  await this.pc.addIceCandidate(candidate)
}
```

❌ **Waiting for all ICE candidates before sending:**
```typescript
// WRONG - slows connection significantly
this.pc.onicecandidate = ({ candidate }) => {
  if (!candidate) {
    // Send all at once
  }
}
```

✅ **Trickle ICE (send immediately):**
```typescript
// CORRECT - send as discovered
this.pc.onicecandidate = ({ candidate }) => {
  if (candidate) {
    this.signaling.send({ type: 'ICE_CANDIDATE', candidate })
  }
}
```

---

## 4.7 Checklist

Before moving to Phase 5, verify:

- [ ] `client/src/lib/peerConnection.ts` exists
- [ ] No TypeScript errors
- [ ] You understand the initiator vs answerer roles
- [ ] You understand why ICE candidates are queued
- [ ] You understand why binaryType must be 'arraybuffer'
- [ ] You understand why only the initiator creates the DataChannel
- [ ] You understand Trickle ICE vs waiting for all candidates

---

**Next Phase:** [Phase 5 - File Sender](./PHASE_05_FILE_SENDER.md)
