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
    ws.onclose = () => {}

    return ws
  }

  send(msg: ClientMessage) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else {
      console.warn('WebSocket not open, message not sent:', msg)
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