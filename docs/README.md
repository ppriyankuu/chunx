# Chunx - Development Guide

This folder contains a step-by-step guide to building Chunx, a peer-to-peer file sharing web application.

---

## 📚 Quick Navigation

### Phase 1: Project Setup
**[PHASE_01_PROJECT_SETUP.md](./PHASE_01_PROJECT_SETUP.md)**
- Create project structure
- Set up Next.js client
- Install dependencies
- Configure StreamSaver

### Phase 2: Shared Types
**[PHASE_02_SHARED_TYPES.md](./PHASE_02_SHARED_TYPES.md)**
- Define TypeScript types
- Signaling messages
- Data channel messages
- Transfer state

### Phase 3: Signaling Client
**[PHASE_03_SIGNALING_CLIENT.md](./PHASE_03_SIGNALING_CLIENT.md)**
- WebSocket wrapper
- Message subscription pattern
- Automatic PING/PONG

### Phase 4: PeerConnection (WebRTC)
**[PHASE_04_PEERCONNECTION.md](./PHASE_04_PEERCONNECTION.md)**
- RTCPeerConnection setup
- DataChannel management
- ICE candidate queue
- Initiator vs Answerer roles

### Phase 5: File Sender
**[PHASE_05_FILE_SENDER.md](./PHASE_05_FILE_SENDER.md)**
- File chunking (64KB)
- Backpressure handling
- Progress tracking

### Phase 6: File Receiver
**[PHASE_06_FILE_RECEIVER.md](./PHASE_06_FILE_RECEIVER.md)**
- StreamSaver.js integration
- Streaming to disk
- Progress tracking

### Phase 7: UI Components
**[PHASE_07_UI_COMPONENTS.md](./PHASE_07_UI_COMPONENTS.md)**
- _app.tsx configuration
- DropZone component
- ProgressBar component

### Phase 8: Home Page
**[PHASE_08_HOME_PAGE.md](./PHASE_08_HOME_PAGE.md)**
- Create session flow
- Join session flow
- Error handling

### Phase 9: Session Page
**[PHASE_09_SESSION_PAGE.md](./PHASE_09_SESSION_PAGE.md)**
- WebRTC connection logic
- File transfer handling
- State machine

### Phase 10: Testing & Debugging
**[PHASE_10_TESTING_DEBUGGING.md](./PHASE_10_TESTING_DEBUGGING.md)**
- Test scenarios
- Debugging tools
- Common issues & solutions

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ installed
- pnpm or npm installed
- Modern browser (Chrome, Firefox, Edge)

### Step 1: Start Signaling Server
```bash
cd ../signaling-server
pnpm install
pnpm dev
```

### Step 2: Set Up Client
```bash
cd ../client
npm install
npm run dev
```

### Step 3: Open Browser
```
http://localhost:3000
```

### Step 4: Test
1. Create a session in one browser window
2. Join the session in another window
3. Drag and drop a file
4. Watch it transfer!

---

## 📁 Final Project Structure

```
chunx/
├── signaling-server/       ← WebSocket signaling server
│   ├── src/
│   │   ├── index.ts        ← HTTP + WebSocket entry
│   │   ├── sessionManager.ts
│   │   ├── relay.ts
│   │   └── types.ts
│   └── package.json
│
├── client/                 ← Next.js frontend
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
└── docs/                   ← This documentation
    ├── README.md
    └── PHASE_01_*.md through PHASE_10_*.md
```

---

## 🎯 Key Concepts

### 1. Signaling Server
- **Purpose:** Help peers find each other
- **Technology:** Node.js + WebSocket
- **What it does:** Relay WebRTC handshake messages
- **What it doesn't do:** Touch file data

### 2. WebRTC
- **Purpose:** Direct peer-to-peer connection
- **Technology:** RTCPeerConnection + DataChannel
- **What it does:** Transfer file data directly between browsers
- **Key benefit:** No server bandwidth costs

### 3. File Chunking
- **Purpose:** Handle large files without crashing
- **Technology:** File API slice()
- **Chunk size:** 64KB
- **Memory usage:** Flat (~100MB) regardless of file size

### 4. Backpressure
- **Purpose:** Prevent buffer overflow
- **Technology:** DataChannel bufferedAmount
- **How:** Pause sending when buffer > 1MB, resume when < 256KB

### 5. Streaming Writes
- **Purpose:** Save large files without using RAM
- **Technology:** StreamSaver.js
- **How:** Service worker intercepts fetch and streams to disk

---

## 🔧 Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend | Next.js 15+ (Pages Router) | UI + Client Logic |
| Language | TypeScript | Type safety |
| Signaling | Node.js + ws | WebSocket server |
| P2P | WebRTC | Direct browser connection |
| File Reading | File API | Read chunks from disk |
| File Writing | StreamSaver.js | Stream to disk |
| Real-time | WebSocket | Signaling communication |
| Network | STUN | NAT traversal |

---

## 📊 System Architecture

```
┌─────────────┐                          ┌─────────────┐
│   Browser A │                          │   Browser B │
│             │                          │             │
│ ┌─────────┐ │                          │ ┌─────────┐ │
│ │Signaling│ │                          │ │Signaling│ │
│ │ Client  │ │                          │ │ Client  │ │
│ └────┬────┘ │                          │ └────┬────┘ │
│      │      │                          │      │      │
│      │ WS   │    ┌──────────────┐      │ WS   │      │
│      ├──────┼───►│   Signaling  │◄─────┼──────┤      │
│      │      │    │    Server    │      │      │      │
│      │      │    │  (WebSocket) │      │      │      │
│      │      │    └──────────────┘      │      │      │
│      │      │                          │      │      │
│ ┌────┴──────┴──────────────────────────┴──────┴────┐ │
│ │            WebRTC DataChannel (P2P)              │ │
│ │                                                  │ │
│ │  ┌──────────┐                           ┌──────┐ │
│ │  │FileSender│                           │File  │ │
│ │  │          │──────[File Chunks]───────►│Recv  │ │
│ │  └──────────┘                           │      │ │
│ │                                         └──────┘ │
│ └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

---

## 🔑 Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `types.ts` | Shared type definitions | ~70 |
| `signalingClient.ts` | WebSocket wrapper | ~80 |
| `peerConnection.ts` | WebRTC setup | ~200 |
| `fileSender.ts` | Chunking + backpressure | ~100 |
| `fileReceiver.ts` | StreamSaver integration | ~100 |
| `session/[code].tsx` | Main session logic | ~300 |
| `index.tsx` | Home page | ~150 |

**Total:** ~1000 lines of TypeScript

---

## ⚠️ Common Pitfalls

### 1. Forgetting to Clean Up
```typescript
// WRONG - memory leak
useEffect(() => {
  signaling.onMessage(handler)
  // No cleanup!
}, [])

// CORRECT
useEffect(() => {
  const unsub = signaling.onMessage(handler)
  return () => {
    unsub()
    peer.close()
    signaling.close()
  }
}, [])
```

### 2. Not Handling ICE Candidate Timing
```typescript
// WRONG - can throw error
await pc.addIceCandidate(candidate)

// CORRECT - queue if early
if (!this.remoteDescSet) {
  this.iceCandidateQueue.push(candidate)
} else {
  await pc.addIceCandidate(candidate)
}
```

### 3. Loading Entire File into Memory
```typescript
// WRONG - crashes on large files
const data = await file.arrayBuffer()

// CORRECT - read in chunks
const chunk = await file.slice(offset, end).arrayBuffer()
```

### 4. Not Using StreamSaver
```typescript
// WRONG - collects all chunks in memory
const chunks: ArrayBuffer[] = []

// CORRECT - stream to disk
this.writer.write(chunk)
```

---

## 📖 Additional Resources

### WebRTC
- [WebRTC Basics](https://webrtc.org/getting-started/overview)
- [MDN WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)

### StreamSaver.js
- [GitHub Repository](https://github.com/jimmywarting/StreamSaver.js)
- [How it Works](https://github.com/jimmywarting/StreamSaver.js/blob/master/docs/flow.md)

### Next.js
- [Pages Router Documentation](https://nextjs.org/docs/pages/building-your-application)
- [Next.js 15 Release Notes](https://nextjs.org/blog/next-15)

### TypeScript
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Discriminated Unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)

---

## 🤝 Working Together

### For You and Your Friend

1. **Share the docs folder** - All phases are self-contained
2. **Work in parallel:**
   - Person A: Signaling server verification (Phase 1)
   - Person B: Client setup (Phase 1)
3. **Merge frequently** - Test after each phase
4. **Use the checklist** - Each phase has verification steps
5. **Reference Phase 10** - For debugging issues

### Communication Tips

- **Phase numbers** - Reference specific phases ("I'm on Phase 4")
- **File paths** - Be specific about which file
- **Error messages** - Copy full console output
- **Browser console** - Share screenshots of errors

---

## ✅ Completion Checklist

### Core Features
- [ ] Create session
- [ ] Join session with code
- [ ] WebRTC connection
- [ ] Send files (any size)
- [ ] Receive files (auto-download)
- [ ] Progress tracking
- [ ] Error handling

### Code Quality
- [ ] TypeScript strict mode
- [ ] No console errors
- [ ] Proper cleanup
- [ ] Type-safe messages

### Performance
- [ ] Flat memory usage
- [ ] Smooth progress
- [ ] No crashes on large files

### UX
- [ ] Clear error messages
- [ ] Loading states
- [ ] Disabled states
- [ ] Responsive design

---

## 🎉 You're Done!

Once all phases are complete and tests pass, you have a working peer-to-peer file sharing application that can handle gigabyte-sized files without server storage!

**Next steps (optional):**
- Deploy signaling server to production
- Add TURN server for better connectivity
- Implement transfer resume
- Add multiple file queue
- Improve mobile UI

Good luck! 🚀
