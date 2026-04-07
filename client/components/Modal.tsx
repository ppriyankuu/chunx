import { useEffect } from 'react'

interface Props {
  title: string
  message: string
  onClose: () => void
}

export function Modal({ title, message, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        animation: 'fadeIn 0.15s ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: '32px 28px 24px',
          maxWidth: 400,
          width: '90%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          textAlign: 'center',
          animation: 'scaleIn 0.2s ease-out',
        }}
      >
        <p style={{
          fontSize: 40,
          margin: '0 0 12px',
          lineHeight: 1,
        }}>
          📁
        </p>
        <h3 style={{
          margin: '0 0 8px',
          fontSize: 18,
          fontWeight: 600,
          color: '#111827',
        }}>
          {title}
        </h3>
        <p style={{
          margin: '0 0 24px',
          fontSize: 14,
          color: '#6b7280',
          lineHeight: 1.5,
        }}>
          {message}
        </p>
        <button
          onClick={onClose}
          autoFocus
          style={{
            padding: '10px 32px',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#1d4ed8')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#2563eb')}
        >
          Got it
        </button>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0 }
          to { opacity: 1 }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.95) }
          to { opacity: 1; transform: scale(1) }
        }
      `}</style>
    </div>
  )
}
