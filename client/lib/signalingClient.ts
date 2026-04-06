import { ClientMessage, ServerMessage } from './types'

type MessageHandler = (msg: ServerMessage) => void

export class SignalingClient {
  private ws: WebSocket
  private handlers: MessageHandler[] = []

  constructor(private url: string) {
    this.ws = this.connect()
  }

  private connect(): WebSocket {
    const ws = new WebSocket(this.url)

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage

        // Auto-reply to server PING to keep connection alive
        if (msg.type === 'PING') {
          this.send({ type: 'PONG' })
          return
        }

        this.handlers.forEach(h => h(msg))
      } catch {
        // Ignore malformed messages silently
      }
    }

    ws.onerror = (err) => console.error('WebSocket error:', err)
    ws.onclose = () => { }

    return ws
  }

  send(msg: any) {
    const data = JSON.stringify(msg);
    if (this.ws.readyState === WebSocket.OPEN) {
      // If ready, send immediately
      this.ws.send(data);
    } else {
      // If still connecting, wait in line until it opens
      this.ws.addEventListener('open', () => {
        this.ws.send(data);
      }, { once: true });
    }
  }
  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler)
    return () => {
      this.handlers = this.handlers.filter(h => h !== handler)
    }
  }

  close() {
    this.ws.close()
  }
}