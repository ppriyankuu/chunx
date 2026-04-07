let streamSaver: any;
if (typeof window !== 'undefined') {
  import('streamsaver').then((module) => {
    streamSaver = module.default || module;
    // ADD THIS LINE: Tell it to use your local mitm.html
    streamSaver.mitm = window.location.origin + '/mitm.html';
  });
}
import { DataChannelControlMessage, ReceiveProgress } from './types'

export class FileReceiver {
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private totalBytes = 0
  private bytesReceived = 0
  private fileName = ''
  private onProgress: ((p: ReceiveProgress) => void) | null = null
  private onComplete: ((fileName: string) => void) | null = null

  onReceiveProgress(cb: (p: ReceiveProgress) => void) { this.onProgress = cb }
  onReceiveComplete(cb: (fileName: string) => void) { this.onComplete = cb }

  // 1. Add 'async' here
  async handleMessage(data: any): Promise<boolean> {
    if (data && data.type) {
      if (data.type === 'FILE_START') {
        this.handleFileStart(data)
        return true
      }
      if (data.type === 'FILE_END') {
        this.handleFileEnd(data)
        return true
      }
    } 
    
    if (data instanceof ArrayBuffer) {
      if (!this.writer) return false
      const chunk = new Uint8Array(data)

      this.bytesReceived += chunk.byteLength

      this.onProgress?.({
        bytesReceived: this.bytesReceived,
        totalBytes: this.totalBytes,
        percent: Math.round((this.bytesReceived / this.totalBytes) * 100),
        fileName: this.fileName,
      })
      
      // 2. ADD AWAIT HERE: Force it to wait until the chunk is safely written
      await this.writer.write(chunk)
      return true
    }
    return false
  }

  private handleFileStart(msg: any) {
    // Catch it whether the sender called it 'name' or 'fileName'
    this.fileName = msg.name || msg.fileName || 'incoming_file';
    this.totalBytes = msg.size || msg.fileSize || 0;
    this.bytesReceived = 0;

    const fileStream = streamSaver.createWriteStream(this.fileName, { size: this.totalBytes });
    this.writer = fileStream.getWriter();
  }

  // 3. Add 'async' here
  private async handleFileEnd(msg: any) {
    if (this.writer) {
      // 4. ADD AWAIT HERE: Ensure all pending writes finish before closing
      await this.writer.ready;
      await this.writer.close();
      this.writer = null;
    }
    this.onComplete?.(msg.name || msg.fileName || 'incoming_file');
  }

  abort() {
    this.writer?.abort()
    this.writer = null
  }
}