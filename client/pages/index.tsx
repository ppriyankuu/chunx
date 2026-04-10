import { useState } from 'react'
import { useRouter } from 'next/router'
import { SignalingClient } from '@/lib/signalingClient'

export default function Home() {
  const router = useRouter()
  const [joinCode, setJoinCode] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // ============================================================================
  // CREATE SESSION
  // ============================================================================

  function handleCreate() {
    setIsLoading(true)
    setError('')

    // Using port 8081
    const signaling = new SignalingClient('ws://localhost:8081')
    
    const unsub = signaling.onMessage((msg) => {
      if (msg.type === 'SESSION_CREATED') {
        unsub()
        signaling.close()
        setIsLoading(false)
        
        router.push(`/session/${msg.code}?role=initiator`)
      }
    })

    signaling.send({ type: 'CREATE_SESSION' })
  }

  // ============================================================================
  // JOIN SESSION
  // ============================================================================

function handleJoin() {
    const code = joinCode.trim().toUpperCase()
    
    if (code.length !== 5) {
      setError('Enter a 5-character code')
      return
    }

    // Bypass the "fake" join completely. 
    // Let the Session Page handle the connection and error checking!
    setIsLoading(true)
    router.push(`/session/${code}?role=answerer`)
  }

  // ============================================================================
  // HANDLE ENTER KEY
  // ============================================================================

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      handleJoin()
    }
  }

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <main className="w-full max-w-[600px] mx-auto sm:my-20 p-8 flex flex-col relative z-20">
      
      <div 
        className="relative rounded-3xl p-[1px] overflow-hidden shadow-2xl animate-shimmer"
        style={{
          backgroundImage: "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(99,179,237,0.2), rgba(255,255,255,0.04))",
          backgroundSize: "200% 200%"
        }}
      >
        {/* Glass card content */}
        <div className="relative z-10 bg-neutral-900/70 backdrop-blur-2xl rounded-[calc(1.5rem-1px)] p-8 sm:p-10 flex flex-col w-full h-full">
          {/* Header */}
          <h1 className="text-4xl sm:text-5xl font-bold mb-3 text-center tracking-[0.02em] text-white">
            Chunx
          </h1>
          
          <p className="text-center text-neutral-400 mb-12 font-medium tracking-wide">
            Peer-to-peer file sharing<br className="sm:hidden" /> — no server storage
          </p>

          {/* Create Session Button */}
          <button
            onClick={handleCreate}
            disabled={isLoading}
            className={`w-full py-4 px-6 mb-8 text-base font-semibold text-white rounded-2xl transition-all duration-300 ${
              isLoading 
                ? 'bg-neutral-600 cursor-not-allowed shadow-none' 
                : 'bg-primary hover:bg-blue-500 shadow-[0_0_40px_-10px_rgba(37,99,235,0.5)] hover:shadow-[0_0_20px_rgba(59,130,246,0.4)] hover:-translate-y-1'
            }`}
          >
            {isLoading ? 'Creating...' : 'Create session'}
          </button>

          {/* Divider */}
          <div className="flex items-center mb-8">
            <div className="flex-1 h-px bg-neutral-700/50" />
            <span className="px-4 text-neutral-500 text-sm font-medium">or join existing</span>
            <div className="flex-1 h-px bg-neutral-700/50" />
          </div>

          {/* Join Session Form */}
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              value={joinCode}
              onChange={(e) => {
                setJoinCode(e.target.value.toUpperCase())
                setError('')
              }}
              onKeyDown={handleKeyDown}
              placeholder="ENTER CODE"
              maxLength={5}
              disabled={isLoading}
              className="flex-1 py-4 px-5 text-lg uppercase tracking-widest text-center text-white bg-neutral-800/60 border border-neutral-700/50 rounded-2xl outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/50 focus:shadow-[0_0_15px_rgba(45,212,191,0.2)] transition-all placeholder:text-neutral-500"
            />
            <button
              onClick={handleJoin}
              disabled={isLoading || joinCode.length === 0}
              className={`py-4 px-8 text-base font-semibold text-white rounded-2xl transition-all duration-300 ${
                (isLoading || joinCode.length === 0)
                  ? 'bg-neutral-700 cursor-not-allowed opacity-50'
                  : 'bg-neutral-800 hover:bg-neutral-700 border border-neutral-600/50 hover:-translate-y-1 shadow-[0_0_15px_-5px_rgba(0,0,0,0.5)] hover:shadow-lg'
              }`}
            >
              {isLoading ? 'Joining...' : 'Join'}
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <p className="text-red-400 mt-4 text-center text-sm font-medium animate-in fade-in slide-in-from-top-2">
              {error}
            </p>
          )}

          {/* Info */}
          <div className="mt-10 p-5 bg-neutral-950/30 border border-neutral-800/50 rounded-xl text-sm text-neutral-400">
            <p className="font-semibold text-neutral-300 mb-2">How it works:</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Create a session & share the code</li>
              <li>The other person enters the code</li>
              <li>Files transfer straight between browsers</li>
            </ol>
          </div>
        </div>
      </div>
    </main>
  )
}