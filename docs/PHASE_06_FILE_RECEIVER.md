# Phase 6: File Receiver

This phase implements the file receiving logic using StreamSaver.js. This allows writing chunks directly to disk as they arrive, keeping memory usage flat regardless of file size.

---

## 6.1 Install StreamSaver

First, make sure StreamSaver is installed in your client:

```bash
cd client
npm install streamsaver
npm install -D @types/streamsaver
```

---

## 6.2 Create the FileReceiver Class

**File:** `client/src/lib/fileReceiver.ts`

Create this file:

```typescript
// client/src/lib/fileReceiver.ts

import streamSaver from 'streamsaver'
import { ReceiveProgress } from './types'

// ============================================================================
// CLASS
// ============================================================================

export class FileReceiver {
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private totalBytes = 0
  private bytesReceived = 0
  private fileName = ''
  private onProgress: ((p: ReceiveProgress) => void) | null = null
  private onComplete: ((fileName: string) => void) | null = null

  // ============================================================================
  // PUBLIC: SUBSCRIBE TO EVENTS
  // ============================================================================

  /**
   * Subscribe to progress updates
   * Called after each chunk is written
   */
  onReceiveProgress(cb: (p: ReceiveProgress) => void) {
    this.onProgress = cb
  }

  /**
   * Subscribe to completion event
   * Called when FILE_END is received and stream is closed
   */
  onReceiveComplete(cb: (fileName: string) => void) {
    this.onComplete = cb
  }

  // ============================================================================
  // PUBLIC: HANDLE INCOMING MESSAGES
  // ============================================================================

  /**
   * Handle a message from the DataChannel
   * 
   * @param data - Either a string (control message) or ArrayBuffer (chunk)
   * @returns true if the message was file-related, false otherwise
   */
  handleMessage(data: string | ArrayBuffer): boolean {
    if (typeof data === 'string') {
      // Parse control message
      const msg = JSON.parse(data) as
        | { type: 'FILE_START'; name: string; size: number; mimeType: string }
        | { type: 'FILE_END'; name: string }

      if (msg.type === 'FILE_START') {
        this.handleFileStart(msg)
        return true
      }

      if (msg.type === 'FILE_END') {
        this.handleFileEnd(msg)
        return true
      }

    } else {
      // ArrayBuffer chunk - write to disk
      if (!this.writer) return false

      const chunk = new Uint8Array(data)
      
      // write() is async but we don't await it
      // WritableStream has its own internal queue for backpressure
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

  // ============================================================================
  // PRIVATE: HANDLE FILE_START
  // ============================================================================

  private handleFileStart(msg: { 
    type: 'FILE_START'
    name: string
    size: number
    mimeType: string
  }) {
    this.fileName = msg.name
    this.totalBytes = msg.size
    this.bytesReceived = 0

    // Open a writable stream that goes directly to disk via StreamSaver
    // This is why memory usage stays flat — chunks stream out as they arrive
    const fileStream = streamSaver.createWriteStream(msg.name, {
      size: msg.size,
    })
    
    this.writer = fileStream.getWriter()
  }

  // ============================================================================
  // PRIVATE: HANDLE FILE_END
  // ============================================================================

  private handleFileEnd(msg: { type: 'FILE_END'; name: string }) {
    // Close the writable stream — this triggers the browser download
    this.writer?.close()
    this.writer = null
    
    // Notify completion
    this.onComplete?.(msg.name)
  }

  // ============================================================================
  // PUBLIC: ABORT (for cleanup)
  // ============================================================================

  /**
   * Abort the transfer (called when peer disconnects mid-transfer)
   */
  abort() {
    this.writer?.abort()
    this.writer = null
  }
}
```

---

## 6.2 How StreamSaver Works

### The Problem

Normally, to save a file in the browser, you'd:

```typescript
// WRONG - collects entire file in memory first
const chunks: ArrayBuffer[] = []
dc.onmessage = (e) => chunks.push(e.data)

// Then create blob and download
const blob = new Blob(chunks)  // 😱 Entire file in memory!
```

This crashes for large files.

### The Solution: StreamSaver.js

StreamSaver uses a **service worker** to intercept a fetch request and pipe chunks directly to a browser download:

```
DataChannel → FileReceiver → StreamSaver → Service Worker → Browser Download
     ↓                                              ↓
  Network                                      Direct to disk
```

**Key benefit:** Each chunk is written to disk immediately — memory usage stays flat.

---

## 6.3 The Three Steps (Receiver Side)

### Step 1: Handle FILE_START

When metadata arrives:

```typescript
if (msg.type === 'FILE_START') {
  this.fileName = msg.name
  this.totalBytes = msg.size
  this.bytesReceived = 0

  // Create writable stream to disk
  const fileStream = streamSaver.createWriteStream(msg.name, {
    size: msg.size,
  })
  this.writer = fileStream.getWriter()
}
```

**What happens:**
- StreamSaver creates a hidden service worker
- Opens a download stream with the given filename
- Returns a writable stream writer

### Step 2: Write Chunks

When ArrayBuffer chunks arrive:

```typescript
const chunk = new Uint8Array(data)
this.writer.write(chunk)  // Writes directly to disk

this.bytesReceived += chunk.byteLength
this.onProgress?.({ ... })
```

**Key points:**
- `write()` is async but we don't await it
- WritableStream has its own internal queue
- Backpressure is handled automatically by the stream

### Step 3: Handle FILE_END

When the end signal arrives:

```typescript
this.writer?.close()  // Closes stream, triggers download
this.writer = null
this.onComplete?.(msg.name)
```

**What happens:**
- StreamSaver finalizes the download
- Browser shows "Save As" or auto-downloads
- File is complete on disk

---

## 6.4 Memory Usage Comparison

### Without StreamSaver (WRONG)

```
Receiving 2GB file:

Memory over time:
  0%    → 0GB
  25%   → 500MB
  50%   → 1GB
  75%   → 1.5GB
  100%  → 2GB 😱 Browser crashes
```

### With StreamSaver (CORRECT)

```
Receiving 2GB file:

Memory over time:
  0%    → 64KB (current chunk)
  25%   → 64KB (current chunk)
  50%   → 64KB (current chunk)
  75%   → 64KB (current chunk)
  100%  → 64KB (current chunk) ✅ Flat memory!
```

---

## 6.5 Usage in Session Page

```typescript
// In your session page component:

const receiverRef = useRef(new FileReceiver())

useEffect(() => {
  const receiver = receiverRef.current

  // Subscribe to progress
  receiver.onReceiveProgress((p) => {
    console.log(`Receiving: ${p.percent}%`)
    setProgress(p.percent)
  })

  // Subscribe to completion
  receiver.onReceiveComplete((fileName) => {
    console.log(`Downloaded: ${fileName}`)
    setStatus('done')
  })

  // Route all DataChannel messages through receiver
  peerConnection.onMessage((msg) => {
    receiver.handleMessage(msg)
  })
}, [])
```

---

## 6.6 StreamSaver Configuration

### mitm.html

StreamSaver requires a service worker intermediary file (`mitm.html`) to be served from **your domain**.

In `_app.tsx`:

```typescript
import { useEffect } from 'react'
import streamSaver from 'streamsaver'

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    streamSaver.mitm = '/mitm.html'
  }, [])

  return <Component {...pageProps} />
}
```

**And copy the file:**

```bash
cp client/node_modules/streamsaver/mitm.html client/public/mitm.html
```

### File Size Option

```typescript
streamSaver.createWriteStream(filename, {
  size: fileSize,  // Optional but recommended
})
```

- Helps the browser show accurate progress
- Some browsers require it for large files

---

## 6.7 Handling Abort/Disconnect

If the sender disconnects mid-transfer:

```typescript
// In session page, when PEER_DISCONNECTED arrives:
receiver.abort()  // Closes the writable stream
```

This prevents a hanging download and cleans up resources.

---

## 6.8 Common Mistakes to Avoid

❌ **Collecting chunks in memory:**
```typescript
// WRONG - defeats the purpose of streaming
const chunks: ArrayBuffer[] = []
handleMessage(data) {
  if (ArrayBuffer.isView(data)) {
    chunks.push(data.buffer)
  }
}
```

✅ **Write each chunk immediately:**
```typescript
// CORRECT - streams to disk
handleMessage(data) {
  if (ArrayBuffer.isView(data)) {
    this.writer.write(new Uint8Array(data.buffer))
  }
}
```

❌ **Awaiting write() calls:**
```typescript
// WRONG - slows down processing unnecessarily
await this.writer.write(chunk)
```

✅ **Don't await write():**
```typescript
// CORRECT - stream handles backpressure internally
this.writer.write(chunk)
```

❌ **Forgetting to close the stream:**
```typescript
// WRONG - download never completes
handleFileEnd() {
  // ... nothing happens
}
```

✅ **Close on FILE_END:**
```typescript
// CORRECT - triggers download
handleFileEnd() {
  this.writer?.close()
}
```

❌ **Not setting mitm.html:**
```typescript
// WRONG - StreamSaver won't work
// streamSaver.mitm is undefined
```

✅ **Set mitm.html in _app.tsx:**
```typescript
// CORRECT
useEffect(() => {
  streamSaver.mitm = '/mitm.html'
}, [])
```

---

## 6.9 Browser Compatibility

StreamSaver works in:
- ✅ Chrome/Edge (best support)
- ✅ Firefox
- ⚠️ Safari (limited support, may fall back to blob download)

For Safari, you might need a fallback:

```typescript
// Fallback for Safari (optional, future improvement)
if (!streamSaver.supported) {
  const blob = new Blob([chunk], { type: mimeType })
  const url = URL.createObjectURL(blob)
  // ... trigger blob download
}
```

---

## 6.10 Testing the FileReceiver

Test with a small file first:

```typescript
// In browser console:
const receiver = new FileReceiver()

receiver.onReceiveProgress((p) => {
  console.log('Progress:', p.percent, '%')
})

receiver.onReceiveComplete((name) => {
  console.log('Complete:', name)
})

// Simulate messages:
receiver.handleMessage(JSON.stringify({
  type: 'FILE_START',
  name: 'test.txt',
  size: 11,
  mimeType: 'text/plain'
}))

receiver.handleMessage(new TextEncoder().encode('Hello World'))

receiver.handleMessage(JSON.stringify({
  type: 'FILE_END',
  name: 'test.txt'
}))
```

---

## 6.11 Checklist

Before moving to Phase 7, verify:

- [ ] `client/src/lib/fileReceiver.ts` exists
- [ ] No TypeScript errors
- [ ] `streamsaver` and `@types/streamsaver` are installed
- [ ] `mitm.html` is copied to `public/`
- [ ] `streamSaver.mitm` is set in `_app.tsx`
- [ ] You understand why we stream to disk (memory)
- [ ] You understand how StreamSaver works with service workers
- [ ] You understand why we don't await write() calls

---

**Next Phase:** [Phase 7 - UI Components](./PHASE_07_UI_COMPONENTS.md)
