# Phase 9: Session Page

This is the most important file in the project — the session page where all the pieces come together. This page handles WebRTC connection, file sending, and file receiving.

---

## 9.1 Create the Session Page

**File:** `client/src/pages/session/[code].tsx`

Create this file:

```typescript
// client/src/pages/session/[code].tsx

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { SignalingClient } from '@/lib/signalingClient'
import { PeerConnection } from '@/lib/peerConnection'
import { sendFile } from '@/lib/fileSender'
import { FileReceiver } from '@/lib/fileReceiver'
import { ServerMessage, TransferState } from '@/lib/types'
import { DropZone } from '@/components/DropZone'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type SessionPhase =
  | 'waiting_for_peer'    // Created session, showing code, waiting
  | 'negotiating'         // Both in room, WebRTC handshake happening
  | 'connected'           // DataChannel open, ready to transfer
  | 'busy'                // Mid-transfer (sending or receiving)
  | 'peer_disconnected'   // Other person left

// ============================================================================
// COMPONENT
// ============================================================================

export default function SessionPage() {
  const router = useRouter()
  const code = router.query.code as string
  const role = router.query.role as 'initiator' | 'answerer' | undefined

  const [phase, setPhase] = useState<SessionPhase>('waiting_for_peer')
  const [transfer, setTransfer] = useState<TransferState>({ phase: 'idle' })

  // Refs hold connection objects — we don't want re-renders to recreate them
  const signalingRef = useRef<SignalingClient | null>(null)
  const peerRef = useRef<PeerConnection | null>(null)
  const receiverRef = useRef(new FileReceiver())

  // ============================================================================
  // SETUP CONNECTIONS (on mount)
  // ============================================================================

  useEffect(() => {
    if (!code || !role) return

    // Create signaling client
    const signaling = new SignalingClient('ws://localhost:8080')
    signalingRef.current = signaling

    // Create peer connection
    const peer = new PeerConnection(signaling, role)
    peerRef.current = peer

    // Get receiver instance
    const receiver = receiverRef.current

    // --- Subscribe to receiver events ---
    receiver.onReceiveProgress((p) => {
      setTransfer({ 
        phase: 'receiving', 
        fileName: p.fileName, 
        progress: p.percent / 100 
      })
    })

    receiver.onReceiveComplete((fileName) => {
      setTransfer({ 
        phase: 'done', 
        fileName, 
        direction: 'received' 
      })
      setPhase('connected')
    })

    // --- Route all DataChannel messages through receiver ---
    peer.onMessage((msg) => {
      receiver.handleMessage(typeof msg === 'string' ? msg : msg as ArrayBuffer)
    })

    // --- Handle DataChannel open ---
    peer.onOpen(() => {
      setPhase('connected')
    })

    // --- Handle signaling messages ---
    const unsub = signaling.onMessage(async (msg: ServerMessage) => {
      switch (msg.type) {
        case 'PEER_JOINED':
          // Fires on initiator when answerer arrives
          // Start the WebRTC handshake now
          setPhase('negotiating')
          await peer.startHandshake()
          break

        case 'SESSION_JOINED':
          // Fires on answerer — they're in, waiting for OFFER
          setPhase('negotiating')
          break

        case 'OFFER':
          // Answerer receives offer from initiator
          await peer.handleOffer(msg.sdp)
          break

        case 'ANSWER':
          // Initiator receives answer from answerer
          await peer.handleAnswer(msg.sdp)
          break

        case 'ICE_CANDIDATE':
          // Both sides receive ICE candidates
          await peer.handleIceCandidate(msg.candidate)
          break

        case 'PEER_DISCONNECTED':
          // Other person left
          receiver.abort()
          setPhase('peer_disconnected')
          peer.close()
          break
      }
    })

    // --- Cleanup on unmount ---
    return () => {
      unsub()
      peer.close()
      signaling.close()
    }
  }, [code, role])

  // ============================================================================
  // FILE SEND HANDLER
  // ============================================================================

  async function handleFileSelected(file: File) {
    const dc = peerRef.current?.getDataChannel()
    if (!dc || dc.readyState !== 'open') {
      console.error('DataChannel not ready')
      return
    }

    // Set UI to busy state
    setPhase('busy')
    setTransfer({ phase: 'sending', fileName: file.name, progress: 0 })

    try {
      await sendFile(dc, file, (p) => {
        setTransfer({ 
          phase: 'sending', 
          fileName: file.name, 
          progress: p.percent / 100 
        })
      })
      
      // Transfer complete
      setTransfer({ 
        phase: 'done', 
        fileName: file.name, 
        direction: 'sent' 
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        console.log('Transfer cancelled')
      } else {
        console.error('Send failed:', err)
      }
    } finally {
      // Return to connected state (not busy)
      setPhase('connected')
    }
  }

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <main style={{
      maxWidth: 600,
      margin: '0 auto',
      padding: 32,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{
          fontSize: 24,
          fontWeight: 600,
          marginBottom: 8,
          color: '#111827',
        }}>
          Session: {code.toUpperCase()}
        </h1>
        
        {phase === 'waiting_for_peer' && (
          <p style={{ color: '#6b7280' }}>
            Share this code with the other person
          </p>
        )}
      </div>

      {/* Phase: Waiting for Peer */}
      {phase === 'waiting_for_peer' && (
        <div style={{
          padding: 24,
          background: '#eff6ff',
          borderRadius: 8,
          textAlign: 'center',
        }}>
          <p style={{
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: 8,
            color: '#2563eb',
            margin: 0,
          }}>
            {code.toUpperCase()}
          </p>
          <p style={{
            color: '#6b7280',
            marginTop: 16,
            margin: 0,
          }}>
            Waiting for the other person to join...
          </p>
        </div>
      )}

      {/* Phase: Negotiating */}
      {phase === 'negotiating' && (
        <div style={{
          padding: 32,
          textAlign: 'center',
          color: '#6b7280',
        }}>
          <div style={{
            width: 40,
            height: 40,
            border: '4px solid #e5e7eb',
            borderTop: '4px solid #2563eb',
            borderRadius: '50%',
            margin: '0 auto 16px',
            animation: 'spin 1s linear infinite',
          }} />
          <p>Connecting to peer...</p>
        </div>
      )}

      {/* Phase: Peer Disconnected */}
      {phase === 'peer_disconnected' && (
        <div style={{
          padding: 24,
          background: '#fef2f2',
          borderRadius: 8,
          textAlign: 'center',
        }}>
          <p style={{ color: '#dc2626', margin: 0 }}>
            The other person disconnected
          </p>
          <button
            onClick={() => router.push('/')}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              background: '#dc2626',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Go Home
          </button>
        </div>
      )}

      {/* Phase: Connected or Busy */}
      {(phase === 'connected' || phase === 'busy') && (
        <>
          {/* Status Message */}
          <div style={{
            padding: 12,
            background: '#f0fdf4',
            borderRadius: 6,
            marginBottom: 24,
          }}>
            <p style={{
              color: '#16a34a',
              margin: 0,
              fontSize: 14,
            }}>
              Connected — either side can send files
            </p>
          </div>

          {/* Drop Zone */}
          <DropZone 
            onFileSelected={handleFileSelected} 
            disabled={phase === 'busy'}
          />

          {/* Transfer Progress */}
          {transfer.phase === 'sending' && (
            <div style={{ marginTop: 24 }}>
              <p style={{ margin: '0 0 8px', fontSize: 14, color: '#374151' }}>
                Sending {transfer.fileName}...
              </p>
              <div style={{
                height: 8,
                background: '#e5e7eb',
                borderRadius: 4,
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${transfer.progress * 100}%`,
                  height: '100%',
                  background: '#2563eb',
                  transition: 'width 0.2s',
                }} />
              </div>
              <p style={{
                margin: '8px 0 0',
                fontSize: 14,
                color: '#6b7280',
                textAlign: 'right',
              }}>
                {Math.round(transfer.progress * 100)}%
              </p>
            </div>
          )}

          {transfer.phase === 'receiving' && (
            <div style={{ marginTop: 24 }}>
              <p style={{ margin: '0 0 8px', fontSize: 14, color: '#374151' }}>
                Receiving {transfer.fileName}...
              </p>
              <div style={{
                height: 8,
                background: '#e5e7eb',
                borderRadius: 4,
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${transfer.progress * 100}%`,
                  height: '100%',
                  background: '#16a34a',
                  transition: 'width 0.2s',
                }} />
              </div>
              <p style={{
                margin: '8px 0 0',
                fontSize: 14,
                color: '#6b7280',
                textAlign: 'right',
              }}>
                {Math.round(transfer.progress * 100)}%
              </p>
            </div>
          )}

          {transfer.phase === 'done' && (
            <div style={{
              marginTop: 24,
              padding: 16,
              background: '#f0fdf4',
              borderRadius: 6,
              textAlign: 'center',
            }}>
              <p style={{
                color: '#16a34a',
                margin: 0,
                fontWeight: 500,
              }}>
                {transfer.direction === 'sent'
                  ? `✓ Sent ${transfer.fileName}`
                  : `✓ Downloaded ${transfer.fileName}`}
              </p>
            </div>
          )}
        </>
      )}

      {/* CSS for spinner animation */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg) }
          100% { transform: rotate(360deg) }
        }
      `}</style>
    </main>
  )
}

```

---

## 9.2 Understanding the State Machine

### SessionPhase States

```typescript
type SessionPhase =
  | 'waiting_for_peer'    // Just created/joined, waiting
  | 'negotiating'         // WebRTC handshake in progress
  | 'connected'           // Ready to transfer files
  | 'busy'                // Currently sending/receiving
  | 'peer_disconnected'   // Other person left
```

**State Flow:**

```
Initiator:
  waiting_for_peer → PEER_JOINED → negotiating → connected

Answerer:
  waiting_for_peer → SESSION_JOINED → negotiating → connected

Both:
  connected → file transfer → busy → connected
  connected → PEER_DISCONNECTED → peer_disconnected
```

### TransferState States

```typescript
type TransferState =
  | { phase: 'idle' }
  | { phase: 'sending'; fileName: string; progress: number }
  | { phase: 'receiving'; fileName: string; progress: number }
  | { phase: 'done'; fileName: string; direction: 'sent' | 'received' }
```

**Usage:**
- Drives the progress bar UI
- Shows file name and completion status

---

## 9.3 The useEffect Setup

### Why Refs?

```typescript
const signalingRef = useRef<SignalingClient | null>(null)
const peerRef = useRef<PeerConnection | null>(null)
const receiverRef = useRef(new FileReceiver())
```

**Why refs instead of state?**
- These objects are mutable and persist across renders
- We don't want re-renders to recreate them
- They're not used for rendering directly

### Cleanup Function

```typescript
return () => {
  unsub()        // Unsubscribe from signaling messages
  peer.close()   // Close DataChannel and RTCPeerConnection
  signaling.close()  // Close WebSocket
}
```

**Why cleanup is critical:**
- Prevents memory leaks
- Closes unnecessary connections
- Prevents duplicate event handlers on re-render

---

## 9.4 Message Flow

### Initiator Side

```
1. Page loads with ?role=initiator
2. Wait for PEER_JOINED from signaling
3. PEER_JOINED arrives → call peer.startHandshake()
4. startHandshake() creates DataChannel, sends OFFER
5. Receive ANSWER → call peer.handleAnswer()
6. DataChannel opens → setPhase('connected')
7. Ready to send/receive files
```

### Answerer Side

```
1. Page loads with ?role=answerer
2. Wait for OFFER from signaling
3. OFFER arrives → call peer.handleOffer()
4. handleOffer() sends ANSWER
5. Receive DataChannel via ondatachannel
6. DataChannel opens → setPhase('connected')
7. Ready to send/receive files
```

---

## 9.5 File Transfer Flow

### Sending a File

```typescript
async function handleFileSelected(file: File) {
  const dc = peerRef.current?.getDataChannel()
  
  // Set busy state (prevents multiple transfers)
  setPhase('busy')
  setTransfer({ phase: 'sending', fileName: file.name, progress: 0 })

  try {
    await sendFile(dc, file, (p) => {
      // Update progress
      setTransfer({ phase: 'sending', fileName: file.name, progress: p.percent / 100 })
    })
    
    // Complete
    setTransfer({ phase: 'done', fileName: file.name, direction: 'sent' })
  } catch (err) {
    console.error('Send failed:', err)
  } finally {
    // Back to connected (not busy)
    setPhase('connected')
  }
}
```

### Receiving a File

```typescript
// In useEffect:
receiver.onReceiveProgress((p) => {
  setTransfer({ phase: 'receiving', fileName: p.fileName, progress: p.percent / 100 })
})

receiver.onReceiveComplete((fileName) => {
  setTransfer({ phase: 'done', fileName, direction: 'received' })
  setPhase('connected')
})

peer.onMessage((msg) => {
  receiver.handleMessage(msg)  // Route all messages to receiver
})
```

---

## 9.6 Bidirectional Transfer

**Important:** The DataChannel is **bidirectional** — both sides can send and receive.

```
Initiator                          Answerer
   │                                   │
   │<══════════ DataChannel ═══════════>│
   │                                   │
   │───[FILE_START]───────────────────>│
   │───[chunk]────────────────────────>│
   │───[chunk]────────────────────────>│
   │───[FILE_END]─────────────────────>│
   │                                   │
   │<──[FILE_START]────────────────────│
   │<──[chunk]─────────────────────────│
   │<──[chunk]─────────────────────────│
   │<──[FILE_END]──────────────────────│
   │                                   │
```

Both sides use the **same** `DropZone` and can send files at any time.

---

## 9.7 Handling Disconnects

```typescript
case 'PEER_DISCONNECTED':
  receiver.abort()      // Stop any ongoing download
  setPhase('peer_disconnected')
  peer.close()          // Clean up WebRTC
  break
```

**What happens:**
- StreamSaver stream is aborted
- WebRTC connection is closed
- UI shows "peer disconnected" message
- User can click "Go Home" to start over

---

## 9.8 Styling Notes

### Progress Bar

```typescript
<div style={{ height: 8, background: '#e5e7eb', borderRadius: 4 }}>
  <div style={{
    width: `${progress * 100}%`,
    height: '100%',
    background: '#2563eb',  // Blue for sending
    transition: 'width 0.2s',
  }} />
</div>
```

### Spinner Animation

```typescript
<style>{`
  @keyframes spin {
    0% { transform: rotate(0deg) }
    100% { transform: rotate(360deg) }
  }
`}</style>
```

Inline CSS-in-JS for the spinner animation.

---

## 9.9 Testing the Session Page

**Test 1: Create and Join**

1. Open two browser windows
2. Window A: Create session (get code `AB12C`)
3. Window B: Join with code `AB12C`
4. Both should show "Connected"

**Test 2: Send Small File**

1. Drag a small file (< 1MB) to drop zone
2. Watch progress bar
3. Receiver should download automatically

**Test 3: Send Large File**

1. Drag a large file (100MB+)
2. Verify progress updates smoothly
3. Verify memory usage stays low (check browser task manager)

**Test 4: Disconnect**

1. Start a transfer
2. Close one browser tab
3. Other tab should show "peer disconnected"

---

## 9.10 Common Mistakes to Avoid

❌ **Not checking DataChannel state:**
```typescript
// WRONG - might send on closed channel
const dc = peerRef.current?.getDataChannel()
await sendFile(dc, file, ...)
```

✅ **Check readyState:**
```typescript
// CORRECT
const dc = peerRef.current?.getDataChannel()
if (!dc || dc.readyState !== 'open') return
```

❌ **Recreating PeerConnection on render:**
```typescript
// WRONG - new connection every render!
const peer = new PeerConnection(...)
```

✅ **Use refs:**
```typescript
// CORRECT
const peerRef = useRef(new PeerConnection(...))
```

❌ **Forgetting to abort receiver on disconnect:**
```typescript
// WRONG - download hangs
case 'PEER_DISCONNECTED':
  setPhase('peer_disconnected')
```

✅ **Abort and cleanup:**
```typescript
// CORRECT
case 'PEER_DISCONNECTED':
  receiver.abort()
  setPhase('peer_disconnected')
  peer.close()
```

❌ **Not handling AbortError:**
```typescript
// WRONG - shows error on cancel
try {
  await sendFile(...)
} catch (err) {
  console.error('Send failed:', err)  // Shows for abort too!
}
```

✅ **Check error type:**
```typescript
// CORRECT
try {
  await sendFile(...)
} catch (err) {
  if ((err as Error).name === 'AbortError') {
    console.log('Transfer cancelled')
  } else {
    console.error('Send failed:', err)
  }
}
```

---

## 9.11 Checklist

Before moving to Phase 10, verify:

- [ ] `client/src/pages/session/[code].tsx` exists
- [ ] No TypeScript errors
- [ ] Signaling server is running
- [ ] Can create session and see code
- [ ] Can join session with code
- [ ] Both sides show "Connected"
- [ ] Can send small file successfully
- [ ] Progress bar updates during transfer
- [ ] Receiver downloads file automatically
- [ ] Disconnect is handled gracefully
- [ ] You understand the state machine flow
- [ ] You understand why refs are used instead of state

---

**Next Phase:** [Phase 10 - Testing & Debugging](./PHASE_10_TESTING_DEBUGGING.md)
