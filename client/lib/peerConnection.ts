import { SignalingClient } from './signalingClient'
import { DataChannelControlMessage } from './types'

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

const DATACHANNEL_LABEL = 'chunx-transfer'

export type DCMessageHandler = (msg: DataChannelControlMessage | ArrayBuffer) => void

export class PeerConnection {
  private pc: RTCPeerConnection
  private dc: RTCDataChannel | null = null
  private onDataChannelMessage: DCMessageHandler | null = null
  private onChannelOpen: (() => void) | null = null
  private iceCandidateQueue: RTCIceCandidateInit[] = []
  private remoteDescSet = false

  constructor(
    private signaling: SignalingClient,
    private role: 'initiator' | 'answerer'
  ) {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    this.setupPCEvents()
  }

  private setupPCEvents() {
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.signaling.send({ type: 'ICE_CANDIDATE', candidate: candidate.toJSON() })
      }
    }
    this.pc.ondatachannel = ({ channel }) => {
      if (this.role === 'answerer') {
        this.attachDataChannel(channel)
      }
    }
  }

  private attachDataChannel(dc: RTCDataChannel) {
    this.dc = dc
    dc.binaryType = 'arraybuffer' // Crucial for large file performance
    dc.onopen = () => {
      this.onChannelOpen?.()
    }
    dc.onmessage = (event) => {
      if (!this.onDataChannelMessage) return
      if (typeof event.data === 'string') {
        this.onDataChannelMessage(JSON.parse(event.data) as DataChannelControlMessage)
      } else {
        this.onDataChannelMessage(event.data as ArrayBuffer)
      }
    }
  }

  async startHandshake() {
    if (this.role !== 'initiator') throw new Error('Only initiator calls startHandshake')
    const dc = this.pc.createDataChannel(DATACHANNEL_LABEL, { ordered: true })
    this.attachDataChannel(dc)
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    this.signaling.send({ type: 'OFFER', sdp: offer })
  }

  async handleOffer(sdp: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp))
    const answer = await this.pc.createAnswer()
    await this.pc.setLocalDescription(answer)
    this.signaling.send({ type: 'ANSWER', sdp: answer })
    await this.drainCandidateQueue()
  }

  async handleAnswer(sdp: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp))
    await this.drainCandidateQueue()
  }

  async handleIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.remoteDescSet) {
      this.iceCandidateQueue.push(candidate)
      return
    }
    await this.pc.addIceCandidate(new RTCIceCandidate(candidate))
  }

  private async drainCandidateQueue() {
    this.remoteDescSet = true
    for (const c of this.iceCandidateQueue) {
      await this.pc.addIceCandidate(new RTCIceCandidate(c))
    }
    this.iceCandidateQueue = []
  }

  getDataChannel(): RTCDataChannel | null { return this.dc }
  onOpen(cb: () => void) {
    this.onChannelOpen = cb
    if (this.dc?.readyState === 'open') cb()
  }
  onMessage(cb: DCMessageHandler) { this.onDataChannelMessage = cb }
  close() {
    this.dc?.close()
    this.pc.close()
  }
}