import { WebSocket } from "ws";
import { createSession, getOtherPeer, joinSession, removePeer } from "./sessionManager";
import { ClientMessage, send } from "./types";


export function handleMessage(ws: WebSocket, raw: string) {
    let message: ClientMessage;
    try {
        message = JSON.parse(raw) as ClientMessage;
    } catch {
        return;
    }

    switch (message.type) {
        case 'CREATE_SESSION': {
            const code = createSession(ws);
            send(ws, { type: 'SESSION_CREATED', code });
            break;
        }

        case 'JOIN_SESSION': {
            const result = joinSession(ws, message.code);
            if (result === 'not_found') {
                send(ws, { type: 'SESSION_NOT_FOUND' });
            } else if (result === 'full') {
                send(ws, { type: 'SESSION_FULL' });
            } else {
                // for the notificaion toast on the frontend 
                send(ws, { type: 'SESSION_JOINED', code: message.code });
                // User-A will get a toast: "Peer joined to session"
                const creator = getOtherPeer(ws);
                if (creator) send(creator, { type: 'PEER_JOINED' });
            }
            break;
        }

        // These three are pure relay — server doesn't interpret them
        case 'OFFER':
        case 'ANSWER':
        case 'ICE_CANDIDATE': {
            const peer = getOtherPeer(ws);
            if (peer) send(peer, message); // forward exact message to other peer
            break;
        }

        case 'PONG': {
            // reset the ping timer; handled in index.ts
            (ws as any)._isAlive = true;
            break;
        }
    }
}

export function handleClose(ws: WebSocket) {
    const otherPeer = removePeer(ws);
    if (otherPeer) {
        // Tell the remaining peer that their partner left
        // This is crucial for the client to reset their "File Transfer Lock"
        send(otherPeer, { type: 'PEER_DISCONNECTED' });
    }
}