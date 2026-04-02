# 🌐 Project Idea: Peer-to-Peer File Sharing Website (for Large Files)

This project is a simple website where two users can share files directly with each other — including large files (like 1GB, 2GB, or more). The file does not go through any server or database. Instead, it goes directly from one user's computer to another using a technology called WebRTC.

The server is only used to help both users connect. After the connection is established, the file transfer happens directly between the two browsers.

---

## 👥 How Many Users in One Session?

For this project, we keep things simple and allow only **two users per session**:

- One user is the **sender** (the person who shares the file)
- The other user is the **receiver** (the person who downloads the file)

This makes the system easier to build and understand.

---

## 🔄 Step-by-Step Working of the Website

1. The sender opens the website and clicks **"Create Session"**. The website generates a unique code (e.g., `AB12C`), which is shown on screen.
2. The sender shares this code with their friend via any messaging app.
3. The receiver opens the same website, enters the code, and clicks **"Join Session"**. Now both users are in the same session.
4. The website uses WebRTC to create a direct connection between both users. The server helps them exchange connection details, but it does not handle any file data.
5. Once the connection is ready, the sender selects a file (or drags and drops it onto the page).
6. Before sending the file, metadata is sent first:
   - File name
   - File size
   - File type

   This helps the receiver prepare the download properly.
7. Instead of sending the whole file at once, the file is broken into small parts called **chunks**, which are sent one by one to the receiver.
8. On the receiver's side, chunks are received one by one and written directly into a file. Once all chunks are received, the file is complete and automatically downloaded.

---

## 💾 How the Sender Handles Large Files

When the sender selects a file, the browser does not load the whole file into memory — that would be very slow and could crash the browser.

Instead, the browser uses the **File API**, which allows the program to read only a small part of the file at a time. The file stays on the user's disk; the program reads a small piece (e.g., 64KB), sends it, then reads the next piece, and so on.

This means even very large files (2GB or more) can be sent without consuming too much memory.

---

## ⚠️ Important: Controlling Speed (Backpressure)

Even though we read from disk in small chunks, we still need to control how fast we send data over the network.

If the sender sends chunks too quickly:
- The WebRTC DataChannel buffer fills up
- Memory usage increases
- The connection may slow down or crash

This problem is called **backpressure**.

To handle it, we:
- Check how much data is waiting in the DataChannel using `bufferedAmount`
- Pause sending when the buffer is too full
- Resume sending when it drops low again

This ensures smooth and stable transfers, especially for large files.

---

## 📥 How the Receiver Handles Large Files

On the receiver's side, we also avoid storing the whole file in memory.

Instead of collecting all chunks first, we use a **streaming approach** — as soon as a chunk is received, it is written directly to a file using a library like **StreamSaver.js**.

This allows the browser to save the file directly to disk while it is being received, keeping memory usage very low even for large files. We also track progress to display a progress bar.

---

## 🌍 Connecting Users: STUN and TURN Servers

In real-world networks, users are often behind routers, Wi-Fi, or mobile networks, so two browsers cannot always connect directly. To solve this, WebRTC uses special servers:

**STUN Server:**
- Helps a user discover their public IP address
- Allows direct peer-to-peer connection in many cases
- Free to use (e.g., Google's STUN server)

**TURN Server:**
- Used when a direct connection fails
- Acts as a relay between users
- Slower and requires bandwidth (usually paid)

For this project:
- We will use a **free STUN server**
- We will **not** use TURN initially
- This means the app may not work on some networks, which is acceptable for learning purposes

---

## 🧠 What the Server Does

The server in this project is very simple — it is called a **signaling server**.

**Its job is to:**
- Create and manage sessions (rooms)
- Allow users to join sessions using a code
- Pass WebRTC connection messages between users

**It does NOT:**
- Store files
- Process file data
- Use a database

Once the connection is established, the server is no longer involved in the file transfer.

---

## ⚙️ Overall System Flow

1. One user creates a session and shares the code. The second user joins using that code.
2. The server connects them via WebRTC.
3. The sender reads the file in small parts from their disk and sends it (while controlling speed using backpressure).
4. The receiver writes each part directly to a file on their disk.
5. The receiver gets the complete file — without the server ever storing it.

---

## 🚀 Final Understanding

This project works because of **streaming**. The file is never stored fully in memory or on a server — it is read, sent, and written in small parts.

We also handle real-world challenges like network speed (backpressure) and connection issues (STUN/TURN).

This is how real-world systems handle large files efficiently.

---

## 🏗 System Architecture

### 🌐 Frontend: Next.js

We use Next.js for building the frontend of the application.

**Why:**
- To create the user interface (Create Session, Join Session, file upload, progress UI)
- To manage routing (home page, session page)
- To handle client-side logic for WebRTC and file transfer

> **Important:** Most of our logic (WebRTC, file handling) runs in the browser, not on the Next.js server side.

---

### 🔌 Backend: Node.js (Signaling Server)

We build a small Node.js server.

**Why:**
- To create and manage sessions (room codes)
- To allow users to join a session
- To exchange WebRTC connection data (offer, answer, ICE candidates)

**What it does NOT do:**
- Store or process files
- Handle file transfer

We use **WebSockets** for real-time communication between users.

---

### 🔗 Real-Time Communication: WebSockets

We need a persistent connection between client and server.

**Why:**
- To instantly send signaling messages between users
- Required for WebRTC setup

Without this, peers cannot establish a connection.

---

### 📡 Peer-to-Peer Connection: WebRTC

This is the core technology of the project.

**Why:**
- To create a direct connection between two browsers
- To transfer data without going through the server

We specifically use:
- `RTCPeerConnection` → manages the connection
- `DataChannel` → sends file data

---

### 📁 File Handling (Sender): File API

We use the browser's **File API**.

**Why:**
- To read files from the user's disk in small chunks
- To avoid loading the entire file into memory

**Key method:** `file.slice()` to read parts of the file

---

### 💾 File Writing (Receiver): Streams / StreamSaver

We need a way to write data directly to disk.

**Why:**
- To avoid storing large files in memory
- To save chunks as they arrive

We use **StreamSaver.js** (or native browser streams where supported).

---

### ⚡ Flow Control: DataChannel Buffer

We must control how fast data is sent.

**Why:**
- WebRTC has an internal buffer
- Prevents crashes and memory overflow

We use:
- `bufferedAmount`
- `bufferedAmountLowThreshold`

---

### 🌍 Network Traversal: STUN Server

We need this for connection setup.

**Why:**
- Helps peers discover their public IP
- Enables direct connection in most cases

We use a free public STUN server (e.g., Google STUN).

---

## 🧩 Optional Later Improvements

These are not required initially but worth knowing:

- **TURN server** → for difficult networks
- **Resume transfer** → if connection drops mid-way
- **Encryption** → additional security layer
- **Multiple peer support** → more than 2 users

---

## 🎯 Final Architecture Summary

| Layer | Technology |
|---|---|
| UI + Client Logic | Next.js |
| Signaling Server | Node.js |
| Real-Time Communication | WebSockets |
| Peer-to-Peer Connection | WebRTC |
| Reading Files in Chunks | File API |
| Writing Files to Disk | StreamSaver.js |
| Connection Support | STUN Server |