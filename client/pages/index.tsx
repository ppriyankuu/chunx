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
    <main style={{
      maxWidth: 480,
      margin: '80px auto',
      padding: 32,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <h1 style={{
        fontSize: 32,
        fontWeight: 600,
        marginBottom: 8,
        textAlign: 'center',
        color: '#111827',
      }}>
        Chunx
      </h1>
      
      <p style={{
        textAlign: 'center',
        color: '#6b7280',
        marginBottom: 40,
      }}>
        Peer-to-peer file sharing — no server storage
      </p>

      {/* Create Session Button */}
      <button
        onClick={handleCreate}
        disabled={isLoading}
        style={{
          display: 'block',
          width: '100%',
          padding: '14px 24px',
          marginBottom: 32,
          fontSize: 16,
          fontWeight: 500,
          color: 'white',
          background: isLoading ? '#9ca3af' : '#2563eb',
          border: 'none',
          borderRadius: 8,
          cursor: isLoading ? 'not-allowed' : 'pointer',
          transition: 'background 0.2s',
        }}
      >
        {isLoading ? 'Creating...' : 'Create session'}
      </button>

      {/* Divider */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        marginBottom: 24,
      }}>
        <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
        <span style={{ padding: '0 12px', color: '#9ca3af', fontSize: 14 }}>
          or join existing
        </span>
        <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
      </div>

      {/* Join Session Form */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={joinCode}
          onChange={(e) => {
            setJoinCode(e.target.value.toUpperCase())
            setError('')
          }}
          onKeyDown={handleKeyDown}
          placeholder="Enter code"
          maxLength={5}
          disabled={isLoading}
          style={{
            flex: 1,
            padding: '12px 16px',
            fontSize: 16,
            textTransform: 'uppercase',
            letterSpacing: 4,
            textAlign: 'center',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            outline: 'none',
          }}
        />
        <button
          onClick={handleJoin}
          disabled={isLoading || joinCode.length === 0}
          style={{
            padding: '12px 24px',
            fontSize: 16,
            fontWeight: 500,
            color: 'white',
            background: (isLoading || joinCode.length === 0) ? '#9ca3af' : '#2563eb',
            border: 'none',
            borderRadius: 8,
            cursor: (isLoading || joinCode.length === 0) ? 'not-allowed' : 'pointer',
            transition: 'background 0.2s',
          }}
        >
          {isLoading ? 'Joining...' : 'Join'}
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <p style={{
          color: '#dc2626',
          marginTop: 16,
          textAlign: 'center',
          fontSize: 14,
        }}>
          {error}
        </p>
      )}

      {/* Info */}
      <div style={{
        marginTop: 40,
        padding: 16,
        background: '#f3f4f6',
        borderRadius: 8,
        fontSize: 14,
        color: '#4b5563',
      }}>
        <p style={{ margin: '0 0 8px', fontWeight: 500 }}>
          How it works:
        </p>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>One person creates a session and shares the code</li>
          <li>The other person enters the code to join</li>
          <li>Files transfer directly between browsers</li>
        </ol>
      </div>
    </main>
  )
}