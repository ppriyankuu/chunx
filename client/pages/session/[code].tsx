import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { SignalingClient } from '@/lib/signalingClient'
import { PeerConnection } from '@/lib/peerConnection'
import { sendFile } from '@/lib/fileSender'
import { FileReceiver } from '@/lib/fileReceiver'
import { ServerMessage, TransferState } from '@/lib/types'
import { DropZone } from '@/components/DropZone'

type SessionPhase =
    | 'waiting_for_peer'
    | 'negotiating'
    | 'connected'
    | 'busy'
    | 'peer_disconnected'

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export default function SessionPage() {
    const router = useRouter()
    const code = router.query.code as string
    const role = router.query.role as 'initiator' | 'answerer' | undefined

    const [phase, setPhase] = useState<SessionPhase>('waiting_for_peer')
    const [transfer, setTransfer] = useState<TransferState>({ phase: 'idle' })

    const signalingRef = useRef<SignalingClient | null>(null)
    const peerRef = useRef<PeerConnection | null>(null)
    const receiverRef = useRef(new FileReceiver())

    useEffect(() => {
        if (!code || !role) return

        const signaling = new SignalingClient('ws://127.0.0.1:8081')
        signalingRef.current = signaling

        signaling.send({ type: 'JOIN_SESSION', code: code })

        const peer = new PeerConnection(signaling, role)
        peerRef.current = peer

        const receiver = receiverRef.current

        // --- NEW: Incoming file prompt (native FS path only) ---
        receiver.onIncomingFileReceived((meta) => {
            setTransfer({
                phase: 'incoming',
                fileName: meta.name,
                size: meta.size,
            })
            setPhase('busy')
        })

        receiver.onReceiveProgress((p) => {
            setTransfer(prev => {
                // Don't override 'incoming' — user hasn't accepted yet.
                // Chunks are buffering in the background.
                if (prev.phase === 'incoming') return prev
                return {
                    phase: 'receiving',
                    fileName: p.fileName,
                    progress: p.percent / 100,
                }
            })
            setPhase('busy')
        })

        receiver.onReceiveComplete((fileName) => {
            setTransfer({
                phase: 'done',
                fileName,
                direction: 'received'
            })
            setPhase('connected')
        })

        // --- Route all DataChannel messages through receiver ---
        peer.onMessage((msg) => {
            receiver.handleMessage(msg as unknown)
        })

        peer.onOpen(() => {
            setPhase('connected')
        })

        const unsub = signaling.onMessage(async (msg: ServerMessage) => {
            switch (msg.type) {
                case 'SESSION_JOINED':
                    if (role === 'answerer') {
                        setPhase('negotiating')
                    }
                    break

                case 'PEER_JOINED':
                    if (role === 'initiator') {
                        setPhase('negotiating')
                        peer.startHandshake().catch(console.error)
                    }
                    break
                case 'OFFER':
                    await peer.handleOffer(msg.sdp)
                    break
                case 'ANSWER':
                    await peer.handleAnswer(msg.sdp)
                    break
                case 'ICE_CANDIDATE':
                    await peer.handleIceCandidate(msg.candidate)
                    break
                case 'PEER_DISCONNECTED':
                    receiver.abort()
                    setPhase('peer_disconnected')
                    peer.close()
                    break
                case 'SESSION_NOT_FOUND':
                    alert('Code not found!')
                    router.push('/')
                    break
                case 'SESSION_FULL':
                    alert('Session is full!')
                    router.push('/')
                    break
            }
        })

        return () => {
            unsub()
            peer.close()
            signaling.close()
        }
    }, [code, role])

    // -------------------------------------------------------------------------
    // Handlers
    // -------------------------------------------------------------------------

    async function handleFileSelected(file: File) {
        const dc = peerRef.current?.getDataChannel()
        if (!dc || dc.readyState !== 'open') {
            console.error('DataChannel not ready')
            return
        }

        setPhase('busy')
        setTransfer({ phase: 'sending', fileName: file.name, progress: 0 })

        try {
            await sendFile({
                dc: dc,
                file: file,
                onProgress: (p) => {
                    setTransfer({
                        phase: 'sending',
                        fileName: file.name,
                        progress: p.percent / 100
                    })
                }
            })

            setTransfer({
                phase: 'done',
                fileName: file.name,
                direction: 'sent'
            })
        } catch (err) {
            if ((err as Error).name === 'AbortError') {
                console.log('Transfer cancelled')
            } else {
                console.error('Send failed:', err)
            }
        } finally {
            setPhase('connected')
        }
    }

    /** Called from the "Save As" button — runs inside a click handler (user gesture). */
    async function handleAcceptFile() {
        setTransfer(prev => {
            if (prev.phase !== 'incoming') return prev
            return { phase: 'receiving', fileName: prev.fileName, progress: 0 }
        })
        await receiverRef.current.acceptFile()
    }

    // -------------------------------------------------------------------------
    // Render
    // -------------------------------------------------------------------------

    return (
        <main style={{
            maxWidth: 600,
            margin: '0 auto',
            padding: 32,
            fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
            <div style={{ marginBottom: 32 }}>
                <h1 style={{
                    fontSize: 24,
                    fontWeight: 600,
                    marginBottom: 8,
                    color: '#111827',
                }}>
                    Session: {code?.toUpperCase()}
                </h1>

                {phase === 'waiting_for_peer' && (
                    <p style={{ color: '#6b7280' }}>
                        Share this code with the other person
                    </p>
                )}
            </div>

            {phase === 'waiting_for_peer' && (
                <div style={{
                    padding: 24,
                    background: '#eff6ff',
                    borderRadius: 8,
                    textAlign: 'center',
                }}>
                    <p style={{
                        fontSize: 32,
                        fontWeight: 700,
                        letterSpacing: 8,
                        color: '#2563eb',
                        margin: 0,
                    }}>
                        {code?.toUpperCase()}
                    </p>
                    <p style={{ color: '#6b7280', marginTop: 16, margin: 0 }}>
                        Waiting for the other person to join...
                    </p>
                </div>
            )}

            {phase === 'negotiating' && (
                <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>
                    <div style={{
                        width: 40, height: 40,
                        border: '4px solid #e5e7eb',
                        borderTop: '4px solid #2563eb',
                        borderRadius: '50%',
                        margin: '0 auto 16px',
                        animation: 'spin 1s linear infinite',
                    }} />
                    <p>Connecting to peer...</p>
                </div>
            )}

            {phase === 'peer_disconnected' && (
                <div style={{
                    padding: 24, background: '#fef2f2',
                    borderRadius: 8, textAlign: 'center',
                }}>
                    <p style={{ color: '#dc2626', margin: 0 }}>
                        The other person disconnected
                    </p>
                    <button
                        onClick={() => router.push('/')}
                        style={{
                            marginTop: 16, padding: '8px 16px',
                            background: '#dc2626', color: 'white',
                            border: 'none', borderRadius: 6, cursor: 'pointer',
                        }}
                    >
                        Go Home
                    </button>
                </div>
            )}

            {(phase === 'connected' || phase === 'busy') && (
                <>
                    <div style={{
                        padding: 12, background: '#f0fdf4',
                        borderRadius: 6, marginBottom: 24,
                    }}>
                        <p style={{ color: '#16a34a', margin: 0, fontSize: 14 }}>
                            Connected — either side can send files
                        </p>
                    </div>

                    <DropZone
                        onFileSelected={handleFileSelected}
                        disabled={phase === 'busy'}
                    />

                    {/* ---------- Incoming file accept prompt (native FS) ---------- */}
                    {transfer.phase === 'incoming' && (
                        <div style={{
                            marginTop: 24,
                            padding: 20,
                            background: '#eff6ff',
                            borderRadius: 8,
                            border: '1px solid #bfdbfe',
                        }}>
                            <p style={{
                                margin: '0 0 4px',
                                fontSize: 13,
                                color: '#6b7280',
                                fontWeight: 500,
                            }}>
                                📥 Incoming file
                            </p>
                            <p style={{
                                margin: '0 0 4px',
                                fontSize: 16,
                                color: '#111827',
                                fontWeight: 600,
                            }}>
                                {transfer.fileName}
                            </p>
                            <p style={{
                                margin: '0 0 16px',
                                fontSize: 13,
                                color: '#6b7280',
                            }}>
                                {formatBytes(transfer.size)}
                            </p>
                            <button
                                onClick={handleAcceptFile}
                                style={{
                                    padding: '8px 20px',
                                    background: '#2563eb',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: 6,
                                    cursor: 'pointer',
                                    fontSize: 14,
                                    fontWeight: 500,
                                }}
                            >
                                Save As…
                            </button>
                        </div>
                    )}

                    {/* ---------- Sending progress ---------- */}
                    {transfer.phase === 'sending' && (
                        <div style={{ marginTop: 24 }}>
                            <p style={{ margin: '0 0 8px', fontSize: 14, color: '#374151' }}>
                                Sending {transfer.fileName}...
                            </p>
                            <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
                                <div style={{
                                    width: `${transfer.progress * 100}%`,
                                    height: '100%', background: '#2563eb',
                                    transition: 'width 0.2s',
                                }} />
                            </div>
                            <p style={{ margin: '8px 0 0', fontSize: 14, color: '#6b7280', textAlign: 'right' }}>
                                {Math.round(transfer.progress * 100)}%
                            </p>
                        </div>
                    )}

                    {/* ---------- Receiving progress ---------- */}
                    {transfer.phase === 'receiving' && (
                        <div style={{ marginTop: 24 }}>
                            <p style={{ margin: '0 0 8px', fontSize: 14, color: '#374151' }}>
                                Receiving {transfer.fileName}...
                            </p>
                            <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
                                <div style={{
                                    width: `${transfer.progress * 100}%`,
                                    height: '100%', background: '#16a34a',
                                    transition: 'width 0.2s',
                                }} />
                            </div>
                            <p style={{ margin: '8px 0 0', fontSize: 14, color: '#6b7280', textAlign: 'right' }}>
                                {Math.round(transfer.progress * 100)}%
                            </p>
                        </div>
                    )}

                    {/* ---------- Done ---------- */}
                    {transfer.phase === 'done' && (
                        <div style={{
                            marginTop: 24, padding: 16,
                            background: '#f0fdf4', borderRadius: 6,
                            textAlign: 'center',
                        }}>
                            <p style={{ color: '#16a34a', margin: 0, fontWeight: 500 }}>
                                {transfer.direction === 'sent'
                                    ? `✓ Sent ${transfer.fileName}`
                                    : `✓ Downloaded ${transfer.fileName}`}
                            </p>
                        </div>
                    )}
                </>
            )}

            <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg) }
          100% { transform: rotate(360deg) }
        }
      `}</style>
        </main>
    )
}