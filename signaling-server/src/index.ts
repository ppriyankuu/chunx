import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { handleMessage, handleClose } from './relay';
import { send } from './types';


const PORT = process.env.PORT ?? 8081;

// 1. Basic HTTP Server (for health checks / deployment)
const httpServer = createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200);
        res.end('ok');
        return;
    }
    res.writeHead(404);
    res.end();
});

// 2. WebSocket Server
const wss = new WebSocketServer({ server: httpServer });

// 3. Heartbeat Logic (Detect Dead Connections)
const HEARTBEAT_INTERVAL = 30_000; // 30 seconds

const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
        if ((ws as any)._isAlive === false) {
            ws.terminate(); // Kill dead connection
            return;
        }
        (ws as any)._isAlive = false; // Mark as potentially dead until PONG
        send(ws, { type: 'PING' });
    });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => clearInterval(heartbeat));

// 4. Connection Handling
wss.on('connection', (ws: WebSocket) => {
    (ws as any)._isAlive = true; // Initially alive

    ws.on('message', (data) => {
        handleMessage(ws, data.toString());
    });

    ws.on('close', () => {
        handleClose(ws);
    });

    ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
        // Don't crash the server — just log it
    });
});

httpServer.listen(PORT, () => {
    console.log(`📡 Signaling server running on ws://localhost:${PORT}`);
})