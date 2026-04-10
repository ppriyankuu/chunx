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

    const [copied, setCopied] = useState(false)

    function handleCopy() {
        if (!code) return
        navigator.clipboard.writeText(code.toUpperCase())
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }

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

    function leaveSession() {
        try {
            receiverRef.current.abort()   // stop file transfer if ongoing
            peerRef.current?.close()      // closes data channel + RTCPeerConnection
            signalingRef.current?.close() // triggers ws.onclose on server
        } catch (e) {
            console.warn('Cleanup error:', e)
        }
    }

    // -------------------------------------------------------------------------
    // Render
    // -------------------------------------------------------------------------

    return (
        <main className="w-full max-w-150 mx-auto p-4 sm:p-8 relative z-20">
            <button
                onClick={() => {
                    leaveSession()
                    router.push('/')
                }}
                className="mb-6 px-4 py-2 text-sm font-medium text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
            >
                ← Back to Home
            </button>
            <div
                className="relative rounded-3xl p-px overflow-hidden shadow-2xl animate-shimmer"
                style={{
                    backgroundImage: "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(99,179,237,0.2), rgba(255,255,255,0.04))",
                    backgroundSize: "200% 200%"
                }}
            >
                <div className="relative z-10 bg-neutral-900/70 backdrop-blur-2xl rounded-[calc(1.5rem-1px)] p-6 sm:p-10 flex flex-col w-full h-full">

                    {/* Header Section */}
                    <div className="mb-10 text-center">
                        <h1 className="text-3xl font-bold text-white mb-2 tracking-tight flex items-center justify-center gap-3">
                            Session:
                            <button
                                onClick={handleCopy}
                                className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors font-mono tracking-wider cursor-pointer select-none"
                                title="Click to copy"
                            >
                                {code?.toUpperCase()}
                            </button>
                        </h1>

                        {copied && (
                            <p className="text-green-400 text-sm mt-1">Copied!</p>
                        )}

                        {phase === 'waiting_for_peer' && (
                            <p className="text-neutral-400 font-medium">
                                Share this code with the other person
                            </p>
                        )}
                    </div>

                    {/* Waiting State */}
                    {phase === 'waiting_for_peer' && (
                        <div className="p-10 bg-primary/10 border border-primary/20 rounded-2xl text-center">
                            <p className="text-5xl font-extrabold tracking-[0.25em] text-primary mb-4 drop-shadow-[0_0_15px_rgba(37,99,235,0.4)]">
                                {code?.toUpperCase()}
                            </p>
                            <p className="text-neutral-400 font-medium">
                                Waiting for the other person to join...
                            </p>
                            {/* Simple pulse dot */}
                            <div className="mt-8 flex justify-center">
                                <span className="relative flex h-4 w-4">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-4 w-4 bg-primary"></span>
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Negotiating / Connecting State */}
                    {phase === 'negotiating' && (
                        <div className="p-10 text-center text-neutral-400">
                            <div className="w-12 h-12 border border-t-primary rounded-full mx-auto mb-6 animate-spin" />
                            <p className="text-lg font-medium">Connecting to peer...</p>
                            <p className="text-sm mt-2">Establishing secure P2P connection</p>
                        </div>
                    )}

                    {/* Disconnected State */}
                    {phase === 'peer_disconnected' && (
                        <div className="p-8 bg-red-950/30 border border-red-900/50 rounded-2xl text-center">
                            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <p className="text-red-400 font-semibold text-lg mb-6">
                                The other person disconnected
                            </p>
                            <button
                                onClick={() => router.push('/')}
                                className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium transition-colors"
                            >
                                Go Home
                            </button>
                        </div>
                    )}

                    {/* Connected & Transferring */}
                    {(phase === 'connected' || phase === 'busy') && (
                        <>
                            <div className="mb-8 p-4 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center justify-center space-x-2">
                                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                <p className="text-green-400 text-sm font-medium">
                                    Securely connected via WebRTC
                                </p>
                            </div>

                            <DropZone
                                onFileSelected={handleFileSelected}
                                disabled={phase === 'busy'}
                            />

                            {/* Incoming file accept prompt */}
                            {transfer.phase === 'incoming' && (
                                <div className="mt-8 p-6 bg-blue-950/40 border border-blue-900/60 rounded-2xl shadow-xl">
                                    <p className="mb-2 text-sm font-medium text-blue-400 flex items-center uppercase tracking-wider">
                                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                        Incoming File
                                    </p>
                                    <p className="mb-1 text-lg font-bold text-white truncate px-1">
                                        {transfer.fileName}
                                    </p>
                                    <p className="mb-6 text-sm text-neutral-400 px-1">
                                        {formatBytes(transfer.size)}
                                    </p>
                                    <button
                                        onClick={handleAcceptFile}
                                        className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-all shadow-[0_0_20px_-5px_rgba(37,99,235,0.5)] hover:shadow-[0_0_30px_-5px_rgba(37,99,235,0.6)]"
                                    >
                                        Accept & Save...
                                    </button>
                                </div>
                            )}

                            {/* Sending / Receiving Progress */}
                            {(transfer.phase === 'sending' || transfer.phase === 'receiving') && (
                                <div className="mt-8 p-6 bg-neutral-800/40 border border-neutral-700/50 rounded-2xl">
                                    <div className="flex justify-between items-end mb-3">
                                        <p className="text-sm font-medium text-neutral-300 truncate pr-4">
                                            {transfer.phase === 'sending' ? 'Sending' : 'Receiving'} <span className="text-white font-semibold">{transfer.fileName}</span>
                                        </p>
                                        <p className="text-xl font-bold text-white">
                                            {Math.round(transfer.progress * 100)}%
                                        </p>
                                    </div>
                                    <div className="h-3 w-full bg-neutral-900 rounded-full overflow-hidden border border-neutral-800">
                                        <div
                                            className={`h-full transition-all duration-300 ease-out ${transfer.phase === 'sending' ? 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.6)]' : 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)]'}`}
                                            style={{ width: `${transfer.progress * 100}%` }}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Transfer Done */}
                            {transfer.phase === 'done' && (
                                <div className="mt-8 p-6 bg-green-950/20 border border-green-900/40 rounded-2xl text-center">
                                    <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                                        <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                    <p className="text-green-400 font-semibold">
                                        {transfer.direction === 'sent'
                                            ? `Successfully sent ${transfer.fileName}`
                                            : `Successfully downloaded ${transfer.fileName}`}
                                    </p>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </main>
    )
}