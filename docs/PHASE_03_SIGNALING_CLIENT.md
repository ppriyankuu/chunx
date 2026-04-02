# Phase 3: Signaling Client

This phase creates a typed WebSocket wrapper that handles all communication with the signaling server. No other module should ever call `JSON.parse` or `JSON.stringify` directly for WebSocket messages.

---

## 3.1 Create the SignalingClient Class

**File:** `client/src/lib/signalingClient.ts`

Create this file:

```typescript
// client/lib/signalingClient.ts

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
        // We automatically respond with PONG to keep the connection alive
        if (msg.type === 'PING') {
          this.send({ type: 'PONG' })
          return
        }
        
        this.handlers.forEach(h => h(msg))
      } catch {
        // Ignore malformed messages silently
      }
    }

    ws.onerror = (err) => {
      console.error('WebSocket error:', err)
    }

    ws.onclose = () => {
      // Connection closed — you could add auto-reconnect logic here
      // For now, we just let the session page handle it
    }

    return ws
  }

  /**
   * Send a message to the signaling server
   */
  send(msg: ClientMessage) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else {
      console.warn('WebSocket not open, message not sent:', msg)
    }
  }

  /**
   * Subscribe to incoming messages
   * Returns an unsubscribe function
   */
  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler)
    
    // Return unsubscribe function
    return () => {
      this.handlers = this.handlers.filter(h => h !== handler)
    }
  }

  /**
   * Close the WebSocket connection
   */
  close() {
    this.ws.close()
  }
}
```

---

## 3.2 How It Works

### Constructor

```typescript
const signaling = new SignalingClient('ws://localhost:8080')
```

- Takes the WebSocket URL as a parameter
- Immediately connects to the server
- Sets up message handlers

### Automatic PING/PONG Handling

The signaling server sends `PING` messages every 30 seconds to detect dead connections. The `SignalingClient` automatically responds with `PONG` — this is internal and callers don't need to worry about it.

```typescript
if (msg.type === 'PING') {
  this.send({ type: 'PONG' })  // Automatic
  return
}
```

### Message Subscription

```typescript
const unsub = signaling.onMessage((msg) => {
  if (msg.type === 'SESSION_CREATED') {
    console.log('Session created:', msg.code)
  }
})

// Later, to unsubscribe:
unsub()
```

- Multiple handlers can subscribe
- Returns an unsubscribe function for cleanup
- Always unsubscribe in `useEffect` cleanup to prevent memory leaks

### Sending Messages

```typescript
signaling.send({ type: 'CREATE_SESSION' })
signaling.send({ type: 'JOIN_SESSION', code: 'AB12C' })
```

- Type-safe: TypeScript ensures you send valid messages
- Checks if WebSocket is open before sending
- Warns if trying to send on a closed connection

---

## 3.3 Why This Abstraction Matters

**Encapsulation:** No other module needs to know about:
- WebSocket API details
- JSON serialization
- Connection state checking

**Type Safety:** All messages are typed, so:
- Invalid messages cause compile errors
- IntelliSense works in your editor
- Refactoring is safer

**Cleanup:** The unsubscribe pattern prevents memory leaks:

```typescript
useEffect(() => {
  const unsub = signaling.onMessage(handler)
  return () => unsub()  // Cleanup on unmount
}, [])
```

---

## 3.4 Common Mistakes to Avoid

❌ **Don't call WebSocket directly:**
```typescript
// WRONG - bypasses the abstraction
ws.send(JSON.stringify({ type: 'CREATE_SESSION' }))
```

✅ **Use the SignalingClient:**
```typescript
// CORRECT - type-safe and clean
signaling.send({ type: 'CREATE_SESSION' })
```

❌ **Don't forget to unsubscribe:**
```typescript
// WRONG - memory leak
signaling.onMessage(handler)
```

✅ **Always cleanup:**
```typescript
// CORRECT
const unsub = signaling.onMessage(handler)
return () => unsub()
```

❌ **Don't handle PING manually:**
```typescript
// WRONG - SignalingClient handles this automatically
if (msg.type === 'PING') { ... }
```

✅ **Let SignalingClient handle it:**
```typescript
// CORRECT - just handle your business messages
if (msg.type === 'SESSION_CREATED') { ... }
```

---

## 3.5 Testing the SignalingClient

You can test it in isolation by creating a simple test page or using the browser console:

```typescript
const signaling = new SignalingClient('ws://localhost:8080')

signaling.onMessage((msg) => {
  console.log('Received:', msg)
})

// Test creating a session
signaling.send({ type: 'CREATE_SESSION' })
// Should receive: { type: 'SESSION_CREATED', code: 'XXXXX' }
```

---

## 3.6 Checklist

Before moving to Phase 4, verify:

- [ ] `client/src/lib/signalingClient.ts` exists
- [ ] No TypeScript errors
- [ ] Signaling server is running on `ws://localhost:8080`
- [ ] You understand the publish/subscribe pattern used
- [ ] You understand why PING/PONG is handled automatically
- [ ] You understand the importance of the unsubscribe function

---

**Next Phase:** [Phase 4 - PeerConnection (WebRTC)](./PHASE_04_PEERCONNECTION.md)
