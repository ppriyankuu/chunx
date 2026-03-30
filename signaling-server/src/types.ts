import { WebSocket } from 'ws';

// Messages CLIENT ----> SERVER
export type ClientMessage =
    | { type: 'CREATE_SESSION' }
    | { type: 'JOIN_SESSION'; code: string }
    | { type: 'OFFER'; sdp: RTCSessionDescriptionInit }
    | { type: 'ANSWER'; sdp: RTCSessionDescriptionInit }
    | { type: 'ICE_CANDIDATE'; candidate: RTCIceCandidateInit }
    | { type: 'PONG' }; // Heartbeat response

// Messages SERVER ----> CLIENT
export type ServerMessage =
    | { type: 'SESSION_CREATED'; code: string }
    | { type: 'SESSION_JOINED'; code: string }
    | { type: 'PEER_JOINED' } // To notify user-A
    | { type: 'SESSION_NOT_FOUND' }
    | { type: 'SESSION_FULL' }
    | { type: 'OFFER'; sdp: RTCSessionDescriptionInit }
    | { type: 'ANSWER'; sdp: RTCSessionDescriptionInit }
    | { type: 'ICE_CANDIDATE'; candidate: RTCIceCandidateInit }
    | { type: 'PEER_DISCONNECTED' }
    | { type: 'PING' }; // Heartbeat request


// Helper function to send messages from the server to the client
export function send(ws: WebSocket, message: ServerMessage) {
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(message));
    }
}