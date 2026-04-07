import { DataChannelControlMessage, SendProgress } from "./types";

export const CHUNK_SIZE = 64 * 1024 // 64Kb per chunk
const BUFFER_PAUSE_THRESHOLD = 1 * 1024 * 1024; // pause when buffer > 1Mb
const BUFFER_RESUME_THRESHOLD = 256 * 1024; // resume when buffer < 256Kb

// ============================================================================
// HELPER: WAIT FOR BUFFER TO DRAIN
// ============================================================================

/**
 * Wait for the DataChannel buffer to drain below the resume threshold
 * 
 * THE PROBLEM (Backpressure):
 * If you send chunks too fast, the DataChannel's internal buffer fills up.
 * This causes:
 * - Memory usage to spike
 * - Connection to slow down or crash
 * - Browser tab to become unresponsive
 * 
 * THE SOLUTION:
 * - Monitor bufferedAmount (bytes waiting to be sent)
 * - Pause when buffer exceeds pause threshold
 * - Wait for bufferedamountlow event before continuing
 */

function waitForBufferDrain(dc: RTCDataChannel): Promise<void> {
    return new Promise((resolve) => {
        dc.bufferedAmountLowThreshold = BUFFER_RESUME_THRESHOLD

        dc.onbufferedamountlow = () => {
            dc.onbufferedamountlow = null;
            resolve();
        }
    })
}

/**
 * Send a file over the DataChannel in chunks with backpressure control
 * 
 * @param dc - The WebRTC DataChannel (must be open)
 * @param file - The File object from file input or drag-drop
 * @param onProgress - Callback called after each chunk is sent
 * @param signal - Optional AbortSignal to cancel mid-transfer
 */

export async function sendFile({
    dc,
    file,
    onProgress,
    signal
}: {
    dc: RTCDataChannel,
    file: File,
    onProgress: (p: SendProgress) => void,
    signal?: AbortSignal
}): Promise<void> {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let offset = 0;
    let chunksSent = 0;

    // STEP 1: SEND METADATA
    console.log('[SENDER] FILE_START:', {
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        totalChunks,
    });

    const fileStartMessage: DataChannelControlMessage = {
        type: 'FILE_START',
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream',
        totalChunks,
    };
    dc.send(JSON.stringify(fileStartMessage));

    // STEP 2: SEND CHUNKS ONE BY ONE WITH BACKPRESSURE

    while (offset < file.size) {
        if (signal?.aborted) {
            throw new DOMException('Transfer aborted', 'AbortError');
        }

        if (dc.bufferedAmount > BUFFER_PAUSE_THRESHOLD) {
            await waitForBufferDrain(dc);
        }

        const end = Math.min(offset + CHUNK_SIZE, file.size);
        const chunk = await file.slice(offset, end).arrayBuffer();

        console.log(`[SENDER] Sending chunk ${chunksSent + 1}/${totalChunks}, ${chunk.byteLength} bytes`);
        dc.send(chunk);

        offset = end;
        chunksSent++;

        onProgress({
            bytesSent: offset,
            totalBytes: file.size,
            percent: Math.round((offset / file.size) * 100),
            chunksTotal: totalChunks,
            chunksSent,
        });
    }

    // STEP 3: SIGNAL END OF FILE
    console.log('[SENDER] FILE_END, total bytes sent:', offset);

    const fileEndMessage: DataChannelControlMessage = {
        type: 'FILE_END',
        name: file.name
    };
    dc.send(JSON.stringify(fileEndMessage));
}