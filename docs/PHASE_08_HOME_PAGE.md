# Phase 8: Home Page

This phase creates the home page where users can create a new session or join an existing one.

---

## 8.1 Create the Home Page

**File:** `client/src/pages/index.tsx`

Create this file:

```typescript
// client/src/pages/index.tsx

import { useState } from 'react'
import { useRouter } from 'next/router'
import { SignalingClient } from '@/lib/signalingClient'

export default function Home() {
  const router = useRouter()
  const [joinCode, setJoinCode] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // ============================================================================
  // CREATE SESSION
  // ============================================================================

  function handleCreate() {
    setIsLoading(true)
    setError('')

    const signaling = new SignalingClient('ws://localhost:8080')
    
    const unsub = signaling.onMessage((msg) => {
      if (msg.type === 'SESSION_CREATED') {
        unsub()
        signaling.close()
        setIsLoading(false)
        
        // Navigate to session page as initiator
        // role=initiator tells the session page to start the WebRTC handshake
        router.push(`/session/${msg.code}?role=initiator`)
      }
    })

    signaling.send({ type: 'CREATE_SESSION' })
  }

  // ============================================================================
  // JOIN SESSION
  // ============================================================================

  function handleJoin() {
    const code = joinCode.trim().toUpperCase()
    
    if (code.length !== 5) {
      setError('Enter a 5-character code')
      return
    }

    setIsLoading(true)
    setError('')

    const signaling = new SignalingClient('ws://localhost:8080')
    
    const unsub = signaling.onMessage((msg) => {
      if (msg.type === 'SESSION_JOINED') {
        unsub()
        signaling.close()
        setIsLoading(false)
        
        // Navigate to session page as answerer
        // role=answerer tells the session page to wait for OFFER
        router.push(`/session/${msg.code}?role=answerer`)
      }
      
      if (msg.type === 'SESSION_NOT_FOUND') {
        setError('Code not found')
        signaling.close()
        setIsLoading(false)
      }
      
      if (msg.type === 'SESSION_FULL') {
        setError('Session already has two people')
        signaling.close()
        setIsLoading(false)
      }
    })

    signaling.send({ type: 'JOIN_SESSION', code })
  }

  // ============================================================================
  // HANDLE ENTER KEY
  // ============================================================================

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      handleJoin()
    }
  }

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <main style={{
      maxWidth: 480,
      margin: '80px auto',
      padding: 32,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <h1 style={{
        fontSize: 32,
        fontWeight: 600,
        marginBottom: 8,
        textAlign: 'center',
        color: '#111827',
      }}>
        Chunx
      </h1>
      
      <p style={{
        textAlign: 'center',
        color: '#6b7280',
        marginBottom: 40,
      }}>
        Peer-to-peer file sharing — no server storage
      </p>

      {/* Create Session Button */}
      <button
        onClick={handleCreate}
        disabled={isLoading}
        style={{
          display: 'block',
          width: '100%',
          padding: '14px 24px',
          marginBottom: 32,
          fontSize: 16,
          fontWeight: 500,
          color: 'white',
          background: isLoading ? '#9ca3af' : '#2563eb',
          border: 'none',
          borderRadius: 8,
          cursor: isLoading ? 'not-allowed' : 'pointer',
          transition: 'background 0.2s',
        }}
      >
        {isLoading ? 'Creating...' : 'Create session'}
      </button>

      {/* Divider */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        marginBottom: 24,
      }}>
        <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
        <span style={{ padding: '0 12px', color: '#9ca3af', fontSize: 14 }}>
          or join existing
        </span>
        <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
      </div>

      {/* Join Session Form */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={joinCode}
          onChange={(e) => {
            setJoinCode(e.target.value.toUpperCase())
            setError('')
          }}
          onKeyDown={handleKeyDown}
          placeholder="Enter code"
          maxLength={5}
          disabled={isLoading}
          style={{
            flex: 1,
            padding: '12px 16px',
            fontSize: 16,
            textTransform: 'uppercase',
            letterSpacing: 4,
            textAlign: 'center',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            outline: 'none',
          }}
        />
        <button
          onClick={handleJoin}
          disabled={isLoading || joinCode.length === 0}
          style={{
            padding: '12px 24px',
            fontSize: 16,
            fontWeight: 500,
            color: 'white',
            background: (isLoading || joinCode.length === 0) ? '#9ca3af' : '#2563eb',
            border: 'none',
            borderRadius: 8,
            cursor: (isLoading || joinCode.length === 0) ? 'not-allowed' : 'pointer',
            transition: 'background 0.2s',
          }}
        >
          {isLoading ? 'Joining...' : 'Join'}
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <p style={{
          color: '#dc2626',
          marginTop: 16,
          textAlign: 'center',
          fontSize: 14,
        }}>
          {error}
        </p>
      )}

      {/* Info */}
      <div style={{
        marginTop: 40,
        padding: 16,
        background: '#f3f4f6',
        borderRadius: 8,
        fontSize: 14,
        color: '#4b5563',
      }}>
        <p style={{ margin: '0 0 8px', fontWeight: 500 }}>
          How it works:
        </p>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>One person creates a session and shares the code</li>
          <li>The other person enters the code to join</li>
          <li>Files transfer directly between browsers</li>
        </ol>
      </div>
    </main>
  )
}
```

---

## 8.2 Understanding the Flow

### Create Session Flow

```
User clicks "Create session"
         ↓
SignalingClient connects to ws://localhost:8080
         ↓
Send: { type: 'CREATE_SESSION' }
         ↓
Receive: { type: 'SESSION_CREATED', code: 'AB12C' }
         ↓
Unsubscribe and close WebSocket
         ↓
Navigate to: /session/AB12C?role=initiator
```

### Join Session Flow

```
User enters code and clicks "Join"
         ↓
Validate code (5 characters)
         ↓
SignalingClient connects to ws://localhost:8080
         ↓
Send: { type: 'JOIN_SESSION', code: 'AB12C' }
         ↓
Receive: { type: 'SESSION_JOINED', code: 'AB12C' }
         ↓
Unsubscribe and close WebSocket
         ↓
Navigate to: /session/AB12C?role=answerer
```

### Error Handling

**Session Not Found:**
```typescript
if (msg.type === 'SESSION_NOT_FOUND') {
  setError('Code not found')
}
```

**Session Full:**
```typescript
if (msg.type === 'SESSION_FULL') {
  setError('Session already has two people')
}
```

---

## 8.3 URL Structure

### Home Page
```
/
```

### Session Page
```
/session/:code?role=initiator    ← Person who created session
/session/:code?role=answerer     ← Person who joined
```

**Query Parameters:**
- `code`: The 5-character session code
- `role`: Either 'initiator' or 'answerer' (determines WebRTC behavior)

---

## 8.4 Input Handling

### Auto-uppercase Code

```typescript
<input
  value={joinCode}
  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
  maxLength={5}
/>
```

- Automatically converts to uppercase as user types
- `maxLength={5}` limits input length
- `textTransform: 'uppercase'` in styles for visual consistency

### Enter Key Support

```typescript
function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter') {
    handleJoin()
  }
}
```

- Allows pressing Enter to join (better UX)

### Trim and Validate

```typescript
const code = joinCode.trim().toUpperCase()

if (code.length !== 5) {
  setError('Enter a 5-character code')
  return
}
```

- Trims whitespace
- Validates length before sending

---

## 8.5 Loading States

```typescript
const [isLoading, setIsLoading] = useState(false)

// When starting:
setIsLoading(true)

// When done (success or error):
setIsLoading(false)
```

**UI changes during loading:**
- Buttons show "Creating..." or "Joining..."
- Buttons are disabled (gray background)
- Input is disabled
- Cursor shows not-allowed

---

## 8.6 WebSocket Cleanup

```typescript
const unsub = signaling.onMessage((msg) => {
  if (msg.type === 'SESSION_CREATED') {
    unsub()      // Unsubscribe from messages
    signaling.close()  // Close WebSocket
  }
})
```

**Why this matters:**
- Prevents memory leaks
- Closes unnecessary connections
- Session page creates its own WebSocket connection

---

## 8.7 Styling Notes

The home page uses **inline styles** for:
- No CSS files to manage
- No Tailwind dependency
- Easy to customize
- Consistent with rest of app

**Color scheme:**
- Primary blue: `#2563eb`
- Text dark: `#111827`
- Text medium: `#6b7280`
- Text light: `#9ca3af`
- Background light: `#f3f4f6`
- Error red: `#dc2626`

---

## 8.8 Testing the Home Page

**Test Create Session:**

1. Start signaling server: `cd signaling-server && pnpm dev`
2. Start Next.js client: `cd client && npm run dev`
3. Open `http://localhost:3000`
4. Click "Create session"
5. Should navigate to `/session/XXXXX?role=initiator`

**Test Join Session:**

1. Create a session (get code, e.g., `AB12C`)
2. Go back to home page
3. Enter the code
4. Click "Join"
5. Should navigate to `/session/AB12C?role=answerer`

**Test Errors:**

1. Enter invalid code (e.g., `ABC`)
2. Should show "Enter a 5-character code"
3. Enter non-existent code (e.g., `XXXXX`)
4. Should show "Code not found"

---

## 8.9 Common Mistakes to Avoid

❌ **Not closing WebSocket after navigation:**
```typescript
// WRONG - memory leak
signaling.onMessage((msg) => {
  if (msg.type === 'SESSION_CREATED') {
    router.push(...)  // WebSocket still open!
  }
})
```

✅ **Always cleanup:**
```typescript
// CORRECT
const unsub = signaling.onMessage((msg) => {
  if (msg.type === 'SESSION_CREATED') {
    unsub()
    signaling.close()
    router.push(...)
  }
})
```

❌ **Forgetting to validate code length:**
```typescript
// WRONG - sends invalid request
function handleJoin() {
  signaling.send({ type: 'JOIN_SESSION', code: joinCode })
}
```

✅ **Validate first:**
```typescript
// CORRECT
function handleJoin() {
  if (code.length !== 5) {
    setError('Enter a 5-character code')
    return
  }
  signaling.send({ type: 'JOIN_SESSION', code })
}
```

❌ **Not passing role parameter:**
```typescript
// WRONG - session page doesn't know the role
router.push(`/session/${msg.code}`)
```

✅ **Always include role:**
```typescript
// CORRECT
router.push(`/session/${msg.code}?role=initiator`)
```

---

## 8.10 Checklist

Before moving to Phase 9, verify:

- [ ] `client/src/pages/index.tsx` exists
- [ ] No TypeScript errors
- [ ] Signaling server is running
- [ ] Clicking "Create session" navigates to session page
- [ ] Joining with a code navigates to session page
- [ ] Error messages display correctly
- [ ] Loading states work (buttons disable during requests)
- [ ] You understand why we close WebSocket after navigation
- [ ] You understand the initiator vs answerer roles

---

**Next Phase:** [Phase 9 - Session Page](./PHASE_09_SESSION_PAGE.md)
