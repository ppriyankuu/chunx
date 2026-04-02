# Phase 1: Project Setup

This phase sets up the basic project structure. Both the signaling server and the Next.js client need to be created.

---

## 1.1 Overall Project Structure

Create this folder structure at the root of your project:

```
chunx/
├── signaling-server/      ← Already exists (you've written this)
├── client/                ← We will create this
└── docs/                  ← Documentation (these files)
```

---

## 1.2 Verify Signaling Server

Your signaling server already exists at `signaling-server/`. Verify it has these files:

```
signaling-server/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts           ← HTTP + WebSocket server entry
│   ├── sessionManager.ts  ← Room creation, join, peer lookup, cleanup
│   ├── relay.ts           ← Message routing (signaling)
│   └── types.ts           ← Discriminated union message types + send helper
└── node_modules/
```

**Install dependencies and test the server:**

```bash
cd signaling-server
pnpm install
pnpm dev
```

You should see:
```
Signaling server running on ws://localhost:8080
```

Keep this running in a separate terminal throughout development.

---

## 1.3 Create the Next.js Client

**Step 1: Create Next.js app**

Run this command in the **root** of your project (same level as `signaling-server/`):

```bash
npx create-next-app@latest client --typescript --app-dir false --src-dir true --eslint --no-tailwind --import-alias "@/*"
```

When prompted:
- **Would you like to use TypeScript?** Yes
- **Would you like to use ESLint?** Yes
- **Would you like to use Tailwind CSS?** No (we'll use inline styles)
- **Would you like to use `src/` directory?** Yes
- **Would you like to use App Router?** No (use Pages Router)
- **Would you like to customize the default import alias?** Yes → `@/*`

**Step 2: Install additional dependencies**

```bash
cd client
npm install streamsaver
npm install -D @types/streamsaver
```

**Step 3: Verify the client runs**

```bash
npm run dev
```

Open `http://localhost:3000` — you should see the default Next.js page.

---

## 1.4 Create the Folder Structure for Client

Inside `client/`, create these folders:

```
client/
├── src/
│   ├── pages/
│   │   ├── _app.tsx       ← We'll modify this
│   │   ├── index.tsx      ← We'll create this
│   │   └── session/
│   │       └── [code].tsx ← We'll create this
│   ├── lib/
│   │   ├── types.ts       ← We'll create this
│   │   ├── signalingClient.ts ← We'll create this
│   │   ├── peerConnection.ts  ← We'll create this
│   │   ├── fileSender.ts      ← We'll create this
│   │   └── fileReceiver.ts    ← We'll create this
│   └── components/
│       ├── DropZone.tsx   ← We'll create this
│       └── ProgressBar.tsx ← Optional (can use inline)
├── public/
│   └── mitm.html          ← We'll create this
├── package.json
└── tsconfig.json
```

**Create the empty folders:**

```bash
cd client/src
mkdir lib components
mkdir -p pages/session
```

---

## 1.5 Copy StreamSaver's mitm.html

StreamSaver requires a service worker intermediary file to be served from **your domain**.

**Step 1: Copy the file**

```bash
cp client/node_modules/streamsaver/mitm.html client/public/mitm.html
```

**Step 2: Verify it's accessible**

With the client dev server running, open:
```
http://localhost:3000/mitm.html
```

You should see a blank page (this is expected — it's a service worker file).

---

## 1.6 Configure tsconfig.json

Make sure your `client/tsconfig.json` has the correct path mapping:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

---

## 1.7 Development Workflow

**Running both servers:**

Open **two terminals**:

**Terminal 1 (Signaling Server):**
```bash
cd signaling-server
pnpm dev
```

**Terminal 2 (Next.js Client):**
```bash
cd client
npm run dev
```

You should have:
- Signaling server: `ws://localhost:8080`
- Next.js client: `http://localhost:3000`

---

## 1.8 Checklist

Before moving to Phase 2, verify:

- [ ] Signaling server starts without errors
- [ ] Next.js client starts without errors
- [ ] `client/src/lib/` folder exists
- [ ] `client/src/components/` folder exists
- [ ] `client/src/pages/session/` folder exists
- [ ] `client/public/mitm.html` exists and is accessible
- [ ] `streamsaver` and `@types/streamsaver` are installed
- [ ] Both servers can run simultaneously

---

**Next Phase:** [Phase 2 - Shared Types](./PHASE_02_SHARED_TYPES.md)
