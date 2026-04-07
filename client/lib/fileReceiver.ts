import { ReceiveProgress } from './types'

// ============================================================================
// TYPES
// ============================================================================

export interface IncomingFileMeta {
  name: string
  size: number
  mimeType: string
  totalChunks: number
}

/**
 * Minimal interface for the FileSystemWritableFileStream returned by
 * FileSystemFileHandle.createWritable(). Avoids needing a global .d.ts
 * since the File System Access API types aren't in all TS lib versions.
 */
interface FSWritable {
  write(data: Uint8Array): Promise<void>
  close(): Promise<void>
  abort(reason?: unknown): Promise<void>
}

// The active write strategy — set once we know which path we're taking
type WriteStrategy =
  | { type: 'native'; writable: FSWritable }
  | { type: 'blob'; chunks: Uint8Array[]; mimeType: string }

// ============================================================================
// FILE RECEIVER
//
// Two write strategies:
// 1. Native File System Access API (Chrome/Edge) — streams directly to disk.
//    Requires a user gesture to call showSaveFilePicker(), so FILE_START
//    emits onIncomingFile. The session page shows a "Save" button; clicking
//    it calls acceptFile() which opens the picker.
//
// 2. Blob fallback (Firefox/Safari) — accumulates chunks in memory and
//    triggers a download via <a download> when FILE_END arrives.
//    No user gesture needed — auto-accepts immediately.
//
// Chunks that arrive before a strategy is established are buffered in
// pendingChunks and flushed once the strategy is ready.
// ============================================================================

export class FileReceiver {
  private strategy: WriteStrategy | null = null
  private pendingChunks: Uint8Array[] = []
  private totalBytes = 0
  private bytesReceived = 0
  private fileName = ''
  private mimeType = ''
  private transferDone = false // FILE_END arrived before user accepted

  // Callbacks
  private onProgress: ((p: ReceiveProgress) => void) | null = null
  private onComplete: ((fileName: string) => void) | null = null
  private onIncomingFile: ((meta: IncomingFileMeta) => void) | null = null

  // Sequential message queue — same pattern as before
  private messageQueue: Array<{ data: unknown; resolve: (result: boolean) => void }> = []
  private processing = false

  // ---------------------------------------------------------------------------
  // Public callback registration
  // ---------------------------------------------------------------------------

  onReceiveProgress(cb: (p: ReceiveProgress) => void) { this.onProgress = cb }
  onReceiveComplete(cb: (fileName: string) => void) { this.onComplete = cb }

  /**
   * Called when FILE_START arrives and the native File System Access API is
   * available. The session page should show an accept prompt; clicking it
   * must call acceptFile() from within the click handler (user gesture).
   */
  onIncomingFileReceived(cb: (meta: IncomingFileMeta) => void) { this.onIncomingFile = cb }

  // ---------------------------------------------------------------------------
  // acceptFile — called from a click handler (user gesture context)
  // ---------------------------------------------------------------------------

  /**
   * Opens showSaveFilePicker, flushes buffered chunks, and continues writing
   * directly to disk. Falls back to blob if the user cancels the picker.
   */
  async acceptFile(): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: this.fileName,
      })
      const writable: FSWritable = await handle.createWritable()
      this.strategy = { type: 'native', writable }

      // Flush chunks that arrived while waiting for the user to click
      for (const chunk of this.pendingChunks) {
        await writable.write(chunk)
      }
      this.pendingChunks = []

      // If FILE_END already arrived, finalize now
      if (this.transferDone) {
        await writable.close()
        this.strategy = null
        this.onComplete?.(this.fileName)
      }
    } catch {
      // User cancelled the picker or API threw — fall back to blob
      console.warn('[RECEIVER] showSaveFilePicker failed, falling back to blob download')
      this.strategy = { type: 'blob', chunks: [...this.pendingChunks], mimeType: this.mimeType }
      this.pendingChunks = []

      if (this.transferDone) {
        this.downloadBlob()
        this.onComplete?.(this.fileName)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Message queue — sequential processing
  // ---------------------------------------------------------------------------

  /** Public API: enqueue a DataChannel message for processing. */
  handleMessage(data: unknown): Promise<boolean> {
    return new Promise((resolve) => {
      this.messageQueue.push({ data, resolve })
      if (!this.processing) {
        this.processing = true
        this.processQueue()
      }
    })
  }

  private async processQueue() {
    while (this.messageQueue.length > 0) {
      const item = this.messageQueue.shift()!
      try {
        const result = await this._processMessage(item.data)
        item.resolve(result)
      } catch (err) {
        console.error('[RECEIVER] Error processing message:', err)
        item.resolve(false)
      }
    }
    this.processing = false
  }

  // ---------------------------------------------------------------------------
  // Core message handling
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _processMessage(data: any): Promise<boolean> {
    // Control messages (JSON parsed by peerConnection.ts)
    if (data && data.type) {
      if (data.type === 'FILE_START') {
        await this.handleFileStart(data)
        return true
      }
      if (data.type === 'FILE_END') {
        await this.handleFileEnd()
        return true
      }
    }

    // Binary chunk
    if (data instanceof ArrayBuffer) {
      await this.handleChunk(data)
      return true
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // FILE_START
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async handleFileStart(msg: any) {
    // Reset state for new transfer
    this.fileName = msg.name || msg.fileName || 'incoming_file'
    this.totalBytes = msg.size || msg.fileSize || 0
    this.mimeType = msg.mimeType || 'application/octet-stream'
    this.bytesReceived = 0
    this.pendingChunks = []
    this.strategy = null
    this.transferDone = false

    console.log('[RECEIVER] FILE_START:', {
      name: this.fileName,
      size: this.totalBytes,
      mimeType: this.mimeType,
      nativeFS: this.supportsNativeFS(),
    })

    if (this.supportsNativeFS()) {
      // Emit to UI — the user must click "Save" to provide a user gesture
      // for showSaveFilePicker(). Chunks will buffer until then.
      this.onIncomingFile?.({
        name: this.fileName,
        size: this.totalBytes,
        mimeType: this.mimeType,
        totalChunks: msg.totalChunks || 0,
      })
    } else {
      // No native FS support — auto-accept with blob accumulation
      console.log('[RECEIVER] Using blob fallback (no showSaveFilePicker)')
      this.strategy = { type: 'blob', chunks: [], mimeType: this.mimeType }
    }
  }

  // ---------------------------------------------------------------------------
  // Binary chunk
  // ---------------------------------------------------------------------------

  private async handleChunk(data: ArrayBuffer) {
    const chunk = new Uint8Array(data)
    this.bytesReceived += chunk.byteLength

    this.onProgress?.({
      bytesReceived: this.bytesReceived,
      totalBytes: this.totalBytes,
      percent: Math.round((this.bytesReceived / this.totalBytes) * 100),
      fileName: this.fileName,
    })

    if (this.strategy) {
      if (this.strategy.type === 'native') {
        // Write directly to disk. Awaiting is safe here — the native FS
        // API resolves promptly (unlike StreamSaver's service worker pipe).
        await this.strategy.writable.write(chunk)
      } else {
        // Blob path — accumulate in memory
        this.strategy.chunks.push(chunk)
      }
    } else {
      // No strategy yet — user hasn't clicked "Save" yet. Buffer in memory.
      this.pendingChunks.push(chunk)
    }
  }

  // ---------------------------------------------------------------------------
  // FILE_END
  // ---------------------------------------------------------------------------

  private async handleFileEnd() {
    console.log('[RECEIVER] FILE_END, bytes:', this.bytesReceived, '/', this.totalBytes)

    if (this.strategy) {
      if (this.strategy.type === 'native') {
        await this.strategy.writable.close()
        console.log('[RECEIVER] Native file saved')
        this.strategy = null
      } else {
        // Blob path — trigger browser download
        this.downloadBlob()
      }
      this.onComplete?.(this.fileName)
    } else {
      // FILE_END arrived before the user clicked "Save".
      // Mark as done — acceptFile() will finalize when called.
      console.log('[RECEIVER] FILE_END arrived before accept — waiting for user')
      this.transferDone = true
    }
  }

  // ---------------------------------------------------------------------------
  // Blob download (Firefox/Safari fallback)
  // ---------------------------------------------------------------------------

  private downloadBlob() {
    if (!this.strategy || this.strategy.type !== 'blob') return

    const blob = new Blob(this.strategy.chunks as BlobPart[], { type: this.strategy.mimeType })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = this.fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)

    // Revoke after a delay to ensure the browser has started the download
    setTimeout(() => URL.revokeObjectURL(url), 10_000)

    console.log('[RECEIVER] Blob download triggered:', this.fileName)
    this.strategy = null
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private supportsNativeFS(): boolean {
    return typeof window !== 'undefined' && 'showSaveFilePicker' in window
  }

  abort() {
    console.warn('[RECEIVER] Abort called')
    if (this.strategy?.type === 'native') {
      this.strategy.writable.abort().catch(() => {})
    }
    this.strategy = null
    this.pendingChunks = []
    this.transferDone = false
  }
}