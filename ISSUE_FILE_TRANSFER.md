# Issue: Received Files Are Corrupt (15 bytes instead of correct size)

## Problem Summary
Files sent via WebRTC DataChannel arrive as **15-byte files** on the receiver's end, regardless of the actual file size. A 200KB PDF becomes 15 bytes. A 85KB JPG becomes 15 bytes.

The 15-byte file is a StreamSaver artifact — it's the HTTP response header/placeholder that the service worker creates before the actual data pipe is established. The binary data is never reaching the download stream.

## Verified Facts
- ✅ Sender correctly reads file in 64KB chunks via `file.slice().arrayBuffer()`
- ✅ Sender sends FILE_START metadata, all chunks, and FILE_END (confirmed via sender console logs)
- ✅ DataChannel is open and binary (`binaryType: 'arraybuffer'`)
- ✅ Receiver's message queue correctly serializes messages (sequential processing works)
- ✅ `handleFileStart` completes: StreamSaver loads, `createWriteStream` succeeds, `getWriter()` returns a valid writer
- ✅ First 2 chunks arrive and are processed: `writer.write(chunk)` is called for chunk 1 and chunk 2
- ✅ Progress UI shows correct byte counts (e.g., 65536/201533, 131072/201533)
- ❌ **Chunks 3, 4, and FILE_END are routed to receiver but NEVER processed** — the message queue's `processQueue()` while-loop stops after iteration 2
- ❌ No error is thrown — the queue just silently stops
- ❌ The resulting file is 15 bytes (StreamSaver placeholder)

## Root Cause: `await writer.write(chunk)` Hangs Indefinitely
The WritableStream's `write()` promise never resolves for chunk 2. This is because:
1. `writer.write()` returns a Promise that resolves when the chunk has been accepted by the stream's internal queue
2. StreamSaver's service worker has a limited internal buffer
3. When the buffer is full, `write()` blocks (its promise doesn't resolve until backpressure clears)
4. Since the message queue is sequential, `processQueue` awaits `writer.write()` and hangs forever
5. Chunks 3, 4, and FILE_END sit in the queue unprocessed
6. The user eventually sees a 15-byte file (StreamSaver's initial response with no data piped through)

## What Has Already Been Tried (Does NOT Work)
1. **Lazy StreamSaver initialization** — Fixed the race where StreamSaver wasn't loaded yet, but didn't solve the write() hang
2. **Message queue (sequential processing)** — Fixed FILE_END racing ahead of FILE_START, but didn't solve the write() hang
3. **Not awaiting writer.write() (fire-and-forget)** — The queue no longer hangs, but chunks still don't reach the file. StreamSaver's internal queue rejects the writes or the service worker pipe is broken.

## Key Files
- `client/lib/fileReceiver.ts` — Contains the FileReceiver class, StreamSaver integration, message queue
- `client/lib/fileSender.ts` — Contains sendFile(), chunking, backpressure
- `client/pages/session/[code].tsx` — Session page, routes DataChannel messages to FileReceiver
- `client/pages/_app.tsx` — Sets `streamSaver.mitm = '/mitm.html'`
- `client/public/mitm.html` — StreamSaver's service worker bridge (copied from node_modules)

## Debug Logging (currently in place)
Extensive `console.log` statements exist in `fileSender.ts` and `fileReceiver.ts`:
- Sender logs: FILE_START metadata, each chunk sent, FILE_END
- Receiver logs: processQueue iterations, FILE_START received, StreamSaver loaded, each chunk received/written, FILE_END

## StreamSaver Setup
```typescript
// _app.tsx
streamSaver.mitm = '/mitm.html'

// fileReceiver.ts
const ss = await import('streamsaver')
ss.mitm = '/mitm.html'
const fileStream = ss.createWriteStream(fileName, { size: totalBytes })
const writer = fileStream.getWriter()
```

The `mitm.html` file exists at `client/public/mitm.html` (copied from `node_modules/streamsaver/mitm.html`).

## Browser
Chrome-based browser (DevTools console output confirms standard browser behavior).

## What Needs Investigation
1. Is StreamSaver's service worker actually registered and active?
2. Is the `write()` call actually writing data to the stream, or is it silently failing?
3. Is StreamSaver compatible with the current Next.js dev server setup (port, headers, etc.)?
4. Does the service worker's fetch interception work correctly with Next.js's dev server?
5. Alternative: Should we use the native `showSaveFilePicker` API with `createWritable()` instead of StreamSaver?
