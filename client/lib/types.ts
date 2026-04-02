// Messages CLIENT → SERVER
export type ClientMessage =
    | { type: 'CREATE_SESSION' }
    | { type: 'JOIN_SESSION'; code: string }
    | { type: 'OFFER'; sdp: RTCSessionDescriptionInit }
    | { type: 'ANSWER'; sdp: RTCSessionDescriptionInit }
    | { type: 'ICE_CANDIDATE'; candidate: RTCIceCandidateInit }
    | { type: 'PONG' }

// Messages SERVER → CLIENT
export type ServerMessage =
    | { type: 'SESSION_CREATED'; code: string }
    | { type: 'SESSION_JOINED'; code: string }
    | { type: 'PEER_JOINED' }
    | { type: 'SESSION_NOT_FOUND' }
    | { type: 'SESSION_FULL' }
    | { type: 'OFFER'; sdp: RTCSessionDescriptionInit }
    | { type: 'ANSWER'; sdp: RTCSessionDescriptionInit }
    | { type: 'ICE_CANDIDATE'; candidate: RTCIceCandidateInit }
    | { type: 'PEER_DISCONNECTED' }
    | { type: 'PING' }


// ============================================================================
// DATA CHANNEL MESSAGES (over WebRTC P2P connection)
// These are exchanged directly between peers after connection is established
// ============================================================================
export type DataChannelControlMessage =
    | {
        type: 'FILE_START';
        name: string;
        size: number;
        mimeType: string;
        totalChunks: number;
    }
    | {
        type: 'FILE_END';
        name: string
    }

// ============================================================================
// TRANSFER STATE
// This drives the UI state in the session page
// ============================================================================
export type TransferState =
    | { phase: 'idle' }
    | { phase: 'sending'; fileName: string; progress: number }  // 0–1
    | { phase: 'receiving'; fileName: string; progress: number }  // 0–1
    | { phase: 'done'; fileName: string; direction: 'sent' | 'received' }


// ============================================================================
// PROGRESS TYPES
// Used by fileSender and fileReceiver to report progress
// ============================================================================

export interface SendProgress {
    bytesSent: number
    totalBytes: number
    percent: number           // 0–100
    chunksTotal: number
    chunksSent: number
}

export interface ReceiveProgress {
    bytesReceived: number
    totalBytes: number
    percent: number
    fileName: string
}
