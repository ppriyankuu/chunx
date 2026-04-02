# Phase 10: Testing & Debugging

This final phase covers testing the complete application, debugging common issues, and verifying everything works correctly.

---

## 10.1 Pre-Flight Checklist

Before testing, ensure:

### Signaling Server
```bash
cd signaling-server
pnpm install
pnpm dev
```
- [ ] Server starts without errors
- [ ] Shows: `Signaling server running on ws://localhost:8080`

### Next.js Client
```bash
cd client
npm install
npm run dev
```
- [ ] Client starts without errors
- [ ] Shows: `Ready in Xms`
- [ ] Opens `http://localhost:3000`

### StreamSaver Setup
- [ ] `client/public/mitm.html` exists
- [ ] Accessible at `http://localhost:3000/mitm.html`

---

## 10.2 Test Scenarios

### Test 1: Basic Connection (Happy Path)

**Steps:**

1. **Browser Window A (Initiator)**
   - Open `http://localhost:3000`
   - Click "Create session"
   - Note the code (e.g., `AB12C`)

2. **Browser Window B (Answerer)**
   - Open `http://localhost:3000`
   - Enter code `AB12C`
   - Click "Join"

3. **Both Windows**
   - Wait for "Connected" message
   - Both should show green status

**Expected Result:**
```
Window A: Create → waiting_for_peer → negotiating → connected
Window B: Join → waiting_for_peer → negotiating → connected
```

**If it fails:**
- Check browser console for errors
- Check signaling server terminal for errors
- Verify WebSocket URL is `ws://localhost:8080`

---

### Test 2: Send Small File (< 1MB)

**Steps:**

1. Connect two browsers (Test 1)
2. In Window A, drag a small text file to drop zone
3. Watch progress bar in both windows
4. Window B should download the file automatically

**Expected Result:**
```
Window A: sending 0% → 50% → 100% → "Sent filename.txt"
Window B: receiving 0% → 50% → 100% → "Downloaded filename.txt"
```

**If it fails:**
- Check for FILE_START message in console
- Verify StreamSaver mitm.html is loaded
- Check for CORS errors

---

### Test 3: Send Large File (100MB+)

**Steps:**

1. Connect two browsers
2. Send a 100MB+ file (video, zip, etc.)
3. Monitor:
   - Progress bar updates smoothly
   - Browser memory usage (Task Manager)
   - No browser crashes

**Expected Result:**
- Memory stays flat (~50-100MB)
- Progress updates smoothly (not jumpy)
- No crashes even for 1GB+ files

**If memory spikes:**
- Check fileSender uses `file.slice()` not `file.arrayBuffer()`
- Verify backpressure thresholds are correct
- Check receiver uses StreamSaver, not blob collection

---

### Test 4: Bidirectional Transfer

**Steps:**

1. Connect two browsers
2. Window A sends file to Window B
3. After completion, Window B sends file to Window A
4. Both files should transfer successfully

**Expected Result:**
```
A → B: File1 transferred
B → A: File2 transferred
```

**If it fails:**
- Verify DataChannel is bidirectional (both sides call `dc.send()`)
- Check both sides have DropZone enabled
- Ensure phase returns to 'connected' after transfer

---

### Test 5: Disconnect Handling

**Steps:**

1. Connect two browsers
2. Start a large file transfer
3. Close Window A mid-transfer
4. Window B should show "peer disconnected"

**Expected Result:**
```
Window B: receiving 45% → "peer disconnected"
Download stops cleanly (no hanging file)
```

**If it fails:**
- Check PEER_DISCONNECTED message is sent
- Verify receiver.abort() is called
- Ensure StreamSaver stream is closed

---

### Test 6: Invalid Session Code

**Steps:**

1. Open `http://localhost:3000`
2. Enter invalid code: `ABC` (too short)
3. Click "Join"
4. Enter non-existent code: `XXXXX`
5. Click "Join"

**Expected Result:**
```
"ABC" → "Enter a 5-character code"
"XXXXX" → "Code not found"
```

**If it fails:**
- Check validation logic in home page
- Verify signaling server returns SESSION_NOT_FOUND

---

### Test 7: Session Full

**Steps:**

1. Window A creates session
2. Window B joins session
3. Window C tries to join same session
4. Window C should see error

**Expected Result:**
```
Window C: "Session already has two people"
```

**If it fails:**
- Check sessionManager returns 'full'
- Verify SESSION_FULL message handled

---

### Test 8: Refresh During Transfer

**Steps:**

1. Start a large file transfer
2. Refresh the receiver's browser mid-transfer
3. Check what happens

**Expected Result:**
- Transfer stops
- Partial file is discarded (StreamSaver behavior)
- No corrupted downloads

**Note:** Resume functionality is a future improvement

---

## 10.3 Debugging Tools

### Browser DevTools: Console

Add logging to track message flow:

```typescript
// In peerConnection.ts
this.pc.oniceconnectionstatechange = () => {
  console.log('ICE state:', this.pc.iceConnectionState)
  // States: new → checking → connected → completed
  // Or: failed, disconnected, closed
}

// In session page
signaling.onMessage((msg) => {
  console.log('Signaling message:', msg.type, msg)
})

peer.onMessage((msg) => {
  console.log('DataChannel message:', typeof msg === 'string' ? JSON.parse(msg) : 'binary', msg)
})
```

### Browser DevTools: Network Tab

**What to check:**
- WebSocket connection established
- WebSocket messages flowing (OFFER, ANSWER, ICE_CANDIDATE)
- No failed requests

**Expected WebSocket frames:**
```
Client → Server: CREATE_SESSION
Server → Client: SESSION_CREATED

Client → Server: JOIN_SESSION
Server → Client: SESSION_JOINED
Server → Client: PEER_JOINED

Client → Server: OFFER
Server → Client: OFFER (relay)

Client → Server: ANSWER
Server → Client: ANSWER (relay)

Client → Server: ICE_CANDIDATE (multiple)
Server → Client: ICE_CANDIDATE (multiple)
```

### Browser DevTools: Application Tab

**Check StreamSaver:**
- Service Workers → mitm.html registered
- Storage → files downloading

### Node.js Server Logging

Add logging to signaling server:

```typescript
// In relay.ts
export function handleMessage(ws: WebSocket, raw: string) {
  const msg = JSON.parse(raw) as ClientMessage
  console.log('[Server] Received:', msg.type)
  // ... rest of logic
}
```

---

## 10.4 Common Issues & Solutions

### Issue 1: "WebSocket not open"

**Symptom:**
```
WebSocket not open, message not sent: { type: 'CREATE_SESSION' }
```

**Causes:**
- Signaling server not running
- Wrong WebSocket URL
- Connection failed

**Solution:**
```bash
# Verify server is running
curl http://localhost:8080/health
# Should return: ok

# Check client URL matches
# client: ws://localhost:8080
# server: PORT 8080
```

---

### Issue 2: ICE Connection Fails

**Symptom:**
```
ICE state: failed
```

**Causes:**
- Both peers behind symmetric NAT
- Firewall blocking P2P
- STUN server unreachable

**Solution:**
```typescript
// Try different STUN servers
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
]
```

**Note:** Some networks require TURN server (future improvement)

---

### Issue 3: File Not Downloading

**Symptom:**
- Transfer completes but no download

**Causes:**
- StreamSaver mitm.html not loaded
- Service worker not registered
- Browser doesn't support streams

**Solution:**
```bash
# Verify mitm.html exists
ls client/public/mitm.html

# Check in browser
# Open: http://localhost:3000/mitm.html
# Should show blank page (expected)
```

```typescript
// In _app.tsx
useEffect(() => {
  streamSaver.mitm = '/mitm.html'
  console.log('StreamSaver mitm set:', streamSaver.mitm)
}, [])
```

---

### Issue 4: Memory Spike During Transfer

**Symptom:**
- Browser uses GBs of memory
- Transfer slows or crashes

**Causes:**
- Not using file.slice() (loading entire file)
- Not using StreamSaver (collecting chunks)
- Backpressure not working

**Solution:**
```typescript
// In fileSender.ts - verify chunking
const chunk = await file.slice(offset, end).arrayBuffer()
// NOT: const chunk = await file.arrayBuffer()

// In fileReceiver.ts - verify streaming
this.writer.write(chunk)
// NOT: chunks.push(chunk)
```

---

### Issue 5: DataChannel Never Opens

**Symptom:**
- Stuck on "Connecting to peer..."
- onOpen never fires

**Causes:**
- ICE candidates arrive before remote description
- DataChannel created by wrong peer
- Signaling messages not relayed

**Solution:**
```typescript
// Verify ICE candidate queue in peerConnection.ts
async handleIceCandidate(candidate: RTCIceCandidateInit) {
  if (!this.remoteDescSet) {
    this.iceCandidateQueue.push(candidate)
    return
  }
  await this.pc.addIceCandidate(new RTCIceCandidate(candidate))
}
```

```typescript
// Verify only initiator creates DataChannel
async startHandshake() {
  if (this.role !== 'initiator') throw new Error(...)
  const dc = this.pc.createDataChannel(...)
}
```

---

### Issue 6: Progress Bar Not Updating

**Symptom:**
- File transfers but progress stays at 0% or 100%

**Causes:**
- onProgress callback not connected
- State not updating correctly
- Progress calculation wrong

**Solution:**
```typescript
// In session page - verify callback
await sendFile(dc, file, (p) => {
  console.log('Progress callback:', p.percent)
  setTransfer({ 
    phase: 'sending', 
    fileName: file.name, 
    progress: p.percent / 100 
  })
})
```

---

### Issue 7: Same File Can't Be Re-selected

**Symptom:**
- Select file, cancel, try to select same file again
- onChange doesn't fire

**Causes:**
- File input value not reset

**Solution:**
```typescript
// In DropZone.tsx
function handleChange(e: ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0]
  if (file) {
    onFileSelected(file)
  }
  e.target.value = ''  // CRITICAL - reset for re-selection
}
```

---

## 10.5 Performance Testing

### Test Memory Usage

**Chrome Task Manager:**
1. Open Chrome Task Manager (Shift + Esc)
2. Start file transfer
3. Watch "Memory" column
4. Should stay flat (~100-200MB)

**Expected:**
```
Time    Memory
0%      150MB
25%     152MB
50%     151MB
75%     153MB
100%    150MB
```

**Bad (memory leak):**
```
Time    Memory
0%      150MB
25%     400MB
50%     800MB
75%     1.2GB  😱
100%    1.5GB
```

---

### Test Transfer Speed

**Expected speeds:**
- Local network: 10-50 MB/s
- Same city: 5-20 MB/s
- Cross-country: 1-10 MB/s

**If slow:**
- Check network conditions
- Verify backpressure thresholds aren't too aggressive
- Try different browsers

---

## 10.6 Browser Compatibility

### Test in Multiple Browsers

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| WebRTC DataChannel | ✅ | ✅ | ✅ | ✅ |
| StreamSaver | ✅ | ✅ | ⚠️ | ✅ |
| File API slice | ✅ | ✅ | ✅ | ✅ |

**Safari note:** May fall back to blob download for very large files

---

## 10.7 Final Checklist

Before considering the project complete:

### Functionality
- [ ] Create session works
- [ ] Join session works
- [ ] Invalid codes show errors
- [ ] Session full shows error
- [ ] WebRTC connection establishes
- [ ] Small files transfer (< 1MB)
- [ ] Large files transfer (1GB+)
- [ ] Progress updates smoothly
- [ ] Bidirectional transfer works
- [ ] Disconnect handled gracefully

### Code Quality
- [ ] No TypeScript errors
- [ ] No console errors
- [ ] Proper cleanup in useEffect
- [ ] Backpressure implemented
- [ ] ICE candidate queue works
- [ ] StreamSaver configured

### Performance
- [ ] Memory stays flat during transfer
- [ ] No memory leaks
- [ ] Smooth progress updates
- [ ] No browser crashes

### UX
- [ ] Loading states visible
- [ ] Error messages clear
- [ ] Progress bar accurate
- [ ] Drop zone responsive
- [ ] Disabled states work

---

## 10.8 Next Steps (Future Improvements)

After everything works:

1. **TURN Server** - For symmetric NAT / strict firewalls
2. **Transfer Resume** - If connection drops mid-file
3. **Multiple Files** - Queue and send sequentially
4. **Multi-peer** - More than 2 users per session
5. **Encryption** - Additional E2E encryption layer
6. **File List** - Show transfer history
7. **QR Code** - Share session code via QR
8. **Mobile UI** - Better mobile responsiveness

---

**Congratulations! You've built Chunx — a peer-to-peer file sharing app that handles large files efficiently!**

---

## Quick Reference

### Project Structure
```
chunx/
├── signaling-server/
│   ├── src/
│   │   ├── index.ts
│   │   ├── sessionManager.ts
│   │   ├── relay.ts
│   │   └── types.ts
│   └── package.json
│
├── client/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── _app.tsx
│   │   │   ├── index.tsx
│   │   │   └── session/
│   │   │       └── [code].tsx
│   │   ├── lib/
│   │   │   ├── types.ts
│   │   │   ├── signalingClient.ts
│   │   │   ├── peerConnection.ts
│   │   │   ├── fileSender.ts
│   │   │   └── fileReceiver.ts
│   │   └── components/
│   │       └── DropZone.tsx
│   ├── public/
│   │   └── mitm.html
│   └── package.json
│
└── docs/
    ├── PHASE_01_PROJECT_SETUP.md
    ├── PHASE_02_SHARED_TYPES.md
    ├── PHASE_03_SIGNALING_CLIENT.md
    ├── PHASE_04_PEERCONNECTION.md
    ├── PHASE_05_FILE_SENDER.md
    ├── PHASE_06_FILE_RECEIVER.md
    ├── PHASE_07_UI_COMPONENTS.md
    ├── PHASE_08_HOME_PAGE.md
    ├── PHASE_09_SESSION_PAGE.md
    └── PHASE_10_TESTING_DEBUGGING.md
```

### Quick Start Commands

```bash
# Terminal 1 - Signaling Server
cd signaling-server
pnpm dev

# Terminal 2 - Next.js Client
cd client
npm run dev

# Open browser
http://localhost:3000
```
