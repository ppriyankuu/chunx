import streamSaver from 'streamsaver'
import { ReceiveProgress } from './types'

export class FileReceiver {
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private totalBytes = 0
  private bytesReceived = 0
  private fileName = ''
  private onProgress: ((p: ReceiveProgress) => void) | null = null
  private onComplete: ((fileName: string) => void) | null = null

  onReceiveProgress(cb: (p: ReceiveProgress) => void) { this.onProgress = cb }
  onReceiveComplete(cb: (fileName: string) => void) { this.onComplete = cb }

  handleMessage(data: string | ArrayBuffer): boolean {
    if (typeof data === 'string') {
      const msg = JSON.parse(data) as any
      if (msg.type === 'FILE_START') {
        this.handleFileStart(msg)
        return true
      }
      if (msg.type === 'FILE_END') {
        this.handleFileEnd(msg)
        return true
      }
    } else {
      if (!this.writer) return false
      const chunk = new Uint8Array(data)
      
      // Streams directly to disk!
      this.writer.write(chunk)
      this.bytesReceived += chunk.byteLength
      
      this.onProgress?.({
        bytesReceived: this.bytesReceived,
        totalBytes: this.totalBytes,
        percent: Math.round((this.bytesReceived / this.totalBytes) * 100),
        fileName: this.fileName,
      })
      return true
    }
    return false
  }

  private handleFileStart(msg: any) {
    this.fileName = msg.name
    this.totalBytes = msg.size
    this.bytesReceived = 0
    const fileStream = streamSaver.createWriteStream(msg.name, { size: msg.size })
    this.writer = fileStream.getWriter()
  }

  private handleFileEnd(msg: any) {
    this.writer?.close()
    this.writer = null
    this.onComplete?.(msg.name)
  }

  abort() {
    this.writer?.abort()
    this.writer = null
  }
}