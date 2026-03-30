import { WebSocket } from "ws";

interface Session {
    code: string; // session Id
    peers: WebSocket[]; // Max 2 peers/users

    createdAt: number;
}

const sessions = new Map<string, Session>();
const peerIndex = new Map<WebSocket, string>(); // allows us to find session from a socket

export function createSession(ws: WebSocket): string {
    const code = generateCode();

    sessions.set(code, { code, peers: [ws], createdAt: Date.now() });
    peerIndex.set(ws, code);

    return code;
}

export function joinSession(
    ws: WebSocket,
    code: string
): 'ok' | 'not_found' | 'full' {
    const session = sessions.get(code);
    if (!session) return 'not_found';

    if (session.peers.length === 2) return 'full';

    session.peers.push(ws);
    peerIndex.set(ws, code);
    return 'ok';
}

// to find the other peer in the same session
export function getOtherPeer(ws: WebSocket): WebSocket | null {
    const code = peerIndex.get(ws);
    if (!code) return null;

    const session = sessions.get(code);
    if (!session) return null;

    return session.peers.find((p) => p !== ws) ?? null;
}

export function removePeer(ws: WebSocket): WebSocket | null {
    const code = peerIndex.get(ws);
    if (!code) return null;

    peerIndex.delete(ws);

    const session = sessions.get(code);
    if (!session) return null;


    // find the other peer before modifying the array
    const otherPeer = session.peers.find((p) => p !== ws) ?? null;

    // filter out the closing peer
    const remaining = session.peers.filter((p) => p !== ws);

    if (remaining.length == 0){
        sessions.delete(code);
    } else {
        session.peers = remaining;
    }

    return otherPeer;
}

// helper 

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(): string {
    let code: string;
    do {
        code = Array.from({ length: 5 }, () =>
            CHARS[Math.floor(Math.random() * CHARS.length)]
        ).join('');
    } while (sessions.has(code)); // to guarantee uniqueness of the code
    return code;
}
