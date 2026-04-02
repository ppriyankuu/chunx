# Phase 5: File Sender

This phase implements the file sending logic with proper chunking and backpressure handling. This is critical for transferring large files (1GB+) without crashing the browser.

---

## 5.1 Create the FileSender Module

**File:** `client/src/lib/fileSender.ts`

Create this file:

```typescript
// client/src/lib/fileSender.ts

import { SendProgress } from './types'

// ============================================================================
// CONFIGURATION
// ============================================================================

const CHUNK_SIZE = 64 * 1024              // 64KB per chunk
const BUFFER_PAUSE_THRESHOLD = 1 * 1024 * 1024   // Pause when buffer > 1MB
const BUFFER_RESUME_THRESHOLD = 256 * 1024       // Resume when buffer < 256KB

// ============================================================================
// HELPER: WAIT FOR BUFFER TO DRAIN
// ============================================================================

/**
 * Wait for the DataChannel buffer to drain below the resume threshold
 * 
 * THE PROBLEM (Backpressure):
 * If you send chunks too fast, the DataChannel's internal buffer fills up.
 * This causes:
 * - Memory usage to spike
 * - Connection to slow down or crash
 * - Browser tab to become unresponsive
 * 
 * THE SOLUTION:
 * - Monitor bufferedAmount (bytes waiting to be sent)
 * - Pause when buffer exceeds pause threshold
 * - Wait for bufferedamountlow event before continuing
 */
function waitForBufferDrain(dc: RTCDataChannel): Promise<void> {
  return new Promise((resolve) => {
    // Set the threshold that triggers the bufferedamountlow event
    dc.bufferedAmountLowThreshold = BUFFER_RESUME_THRESHOLD
    
    // When buffer drains below threshold, resolve the promise
    dc.onbufferedamountlow = () => {
      dc.onbufferedamountlow = null  // Clean up handler
      resolve()
    }
  })
}

// ============================================================================
// MAIN: SEND FILE FUNCTION
// ============================================================================

/**
 * Send a file over the DataChannel in chunks with backpressure control
 * 
 * @param dc - The WebRTC DataChannel (must be open)
 * @param file - The File object from file input or drag-drop
 * @param onProgress - Callback called after each chunk is sent
 * @param signal - Optional AbortSignal to cancel mid-transfer
 */
export async function sendFile(
  dc: RTCDataChannel,
  file: File,
  onProgress: (p: SendProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
  let offset = 0
  let chunksSent = 0

  // ==========================================================================
  // STEP 1: SEND METADATA
  // Tell the receiver about the file before sending chunks
  // ==========================================================================
  
  dc.send(
    JSON.stringify({
      type: 'FILE_START',
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      totalChunks,
    })
  )

  // ==========================================================================
  // STEP 2: SEND CHUNKS ONE BY ONE WITH BACKPRESSURE
  // ==========================================================================
  
  while (offset < file.size) {
    // Check if transfer was cancelled
    if (signal?.aborted) {
      throw new DOMException('Transfer aborted', 'AbortError')
    }

    // --- BACKPRESSURE CHECK ---
    // If buffer is too full, wait for it to drain
    if (dc.bufferedAmount > BUFFER_PAUSE_THRESHOLD) {
      await waitForBufferDrain(dc)
    }

    // --- READ NEXT CHUNK FROM DISK ---
    // file.slice().arrayBuffer() reads only this 64KB window from disk
    // The full file is NEVER loaded into memory at once
    const end = Math.min(offset + CHUNK_SIZE, file.size)
    const chunk = await file.slice(offset, end).arrayBuffer()
    
    // --- SEND CHUNK ---
    dc.send(chunk)

    // Update progress
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

  // ==========================================================================
  // STEP 3: SIGNAL END OF FILE
  // ==========================================================================
  
  dc.send(JSON.stringify({ type: 'FILE_END', name: file.name }))
}

// ============================================================================
// EXPORTED CONSTANTS (for UI to display chunk info if needed)
// ============================================================================

export { CHUNK_SIZE }
```

---

## 5.2 Understanding Backpressure

### The Problem

WebRTC DataChannels have an internal buffer. When you call `dc.send(chunk)`, the data doesn't go out instantly — it's queued in the buffer until the network can send it.

If you send chunks faster than the network can handle:

```
Send loop (too fast):
  dc.send(chunk)  → Buffer: 100KB
  dc.send(chunk)  → Buffer: 200KB
  dc.send(chunk)  → Buffer: 300KB
  dc.send(chunk)  → Buffer: 400KB
  ...
  dc.send(chunk)  → Buffer: 50MB 😱 Memory spike!
  Browser crashes or connection drops
```

### The Solution: Monitor bufferedAmount

```typescript
if (dc.bufferedAmount > BUFFER_PAUSE_THRESHOLD) {
  await waitForBufferDrain(dc)  // Pause sending
}
```

**Visual flow:**

```
Send chunk → Check buffer → If too full, wait → Continue sending
                  ↓
          bufferedamountlow event fires
                  ↓
          Resume sending next chunk
```

### Threshold Values

```typescript
const BUFFER_PAUSE_THRESHOLD = 1 * 1024 * 1024   // 1MB - pause here
const BUFFER_RESUME_THRESHOLD = 256 * 1024       // 256KB - resume here
```

- **Pause at 1MB**: Don't let the buffer grow too large
- **Resume at 256KB**: Wait until buffer drains significantly before continuing
- This hysteresis prevents rapid pause/resume cycling

---

## 5.3 How File Reading Works

### File API with slice()

```typescript
const chunk = await file.slice(offset, end).arrayBuffer()
```

**Key points:**

1. **`file.slice(offset, end)`**: Creates a Blob representing bytes from `offset` to `end`
2. **`.arrayBuffer()`**: Reads those bytes into an ArrayBuffer
3. **Only 64KB at a time**: The rest of the file stays on disk

**Memory usage:**

```
2GB file on disk:
  ┌─────────────────────────────────────┐
  │ 2GB file (stays on disk)            │
  └─────────────────────────────────────┘
  
Memory at any moment:
  ┌──────────┐
  │ 64KB     │ ← Only current chunk in memory
  └──────────┘
```

This is why we can handle 1GB+ files without crashing.

---

## 5.4 The Three Steps

### Step 1: Send Metadata

Before any file data, send a control message:

```typescript
dc.send(JSON.stringify({
  type: 'FILE_START',
  name: file.name,
  size: file.size,
  mimeType: file.type,
  totalChunks,
}))
```

**Why?** The receiver needs to:
- Know the file name for download
- Know the file size for progress tracking
- Set up StreamSaver before chunks arrive
- Prepare the writable stream

### Step 2: Send Chunks

Loop through the file, reading and sending one chunk at a time:

```typescript
while (offset < file.size) {
  // Backpressure check
  if (dc.bufferedAmount > THRESHOLD) {
    await waitForBufferDrain(dc)
  }
  
  // Read chunk from disk
  const chunk = await file.slice(offset, end).arrayBuffer()
  
  // Send chunk
  dc.send(chunk)
  
  // Update progress
  offset += chunk.byteLength
}
```

### Step 3: Signal End

After all chunks are sent:

```typescript
dc.send(JSON.stringify({ type: 'FILE_END', name: file.name }))
```

**Why?** The receiver needs to:
- Know the file is complete
- Close the StreamSaver writable stream
- Trigger the browser download
- Update UI to show completion

---

## 5.5 AbortSignal for Cancellation

The `signal` parameter allows cancelling mid-transfer:

```typescript
// In the session page:
const abortController = new AbortController()

await sendFile(dc, file, onProgress, abortController.signal)

// Later, if needed:
abortController.abort()  // Throws AbortError in sendFile
```

This is useful if:
- User clicks "Cancel" button
- Peer disconnects mid-transfer
- Navigation away from page

---

## 5.6 Usage Example

```typescript
// In your session page component:

const dc = peerConnection.getDataChannel()

if (dc && dc.readyState === 'open') {
  try {
    await sendFile(dc, file, (progress) => {
      console.log(`Progress: ${progress.percent}%`)
      setProgress(progress.percent)
    })
    console.log('File sent successfully!')
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('Transfer cancelled')
    } else {
      console.error('Send failed:', err)
    }
  }
}
```

---

## 5.7 Common Mistakes to Avoid

❌ **Sending the entire file at once:**
```typescript
// WRONG - loads entire file into memory
const data = await file.arrayBuffer()
dc.send(data)
```

✅ **Send in chunks:**
```typescript
// CORRECT - reads 64KB at a time
const chunk = await file.slice(offset, end).arrayBuffer()
dc.send(chunk)
```

❌ **Ignoring backpressure:**
```typescript
// WRONG - sends as fast as possible
for (let i = 0; i < totalChunks; i++) {
  dc.send(chunk)  // Buffer fills up!
}
```

✅ **Check bufferedAmount:**
```typescript
// CORRECT - pauses when buffer is full
if (dc.bufferedAmount > THRESHOLD) {
  await waitForBufferDrain(dc)
}
dc.send(chunk)
```

❌ **Not sending metadata first:**
```typescript
// WRONG - receiver doesn't know what's coming
dc.send(chunk1)
dc.send(chunk2)
```

✅ **Send FILE_START first:**
```typescript
// CORRECT - receiver can prepare
dc.send(JSON.stringify({ type: 'FILE_START', ... }))
dc.send(chunk1)
dc.send(chunk2)
```

❌ **Forgetting to send FILE_END:**
```typescript
// WRONG - receiver waits forever
// ... all chunks sent, but no end signal
```

✅ **Always signal completion:**
```typescript
// CORRECT - receiver knows when done
dc.send(JSON.stringify({ type: 'FILE_END', name: file.name }))
```

---

## 5.8 Testing the FileSender

You can test it with a small file first:

```typescript
// In browser console on session page:
const dc = peerConnection.getDataChannel()
const file = new File(['hello world'], 'test.txt', { type: 'text/plain' })

await sendFile(dc, file, (p) => {
  console.log('Progress:', p.percent, '%')
})
```

Then test with larger files (100MB, 500MB, 1GB+) to verify backpressure works.

---

## 5.9 Checklist

Before moving to Phase 6, verify:

- [ ] `client/src/lib/fileSender.ts` exists
- [ ] No TypeScript errors
- [ ] You understand why we send in chunks (memory)
- [ ] You understand why we check bufferedAmount (backpressure)
- [ ] You understand the three-step process (metadata → chunks → end)
- [ ] You understand how file.slice() works
- [ ] You understand the purpose of AbortSignal

---

**Next Phase:** [Phase 6 - File Receiver](./PHASE_06_FILE_RECEIVER.md)
