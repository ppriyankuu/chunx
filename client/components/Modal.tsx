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
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-neutral-900 border border-neutral-700/50 rounded-2xl p-8 pb-6 max-w-sm w-[90%] shadow-2xl text-center animate-in zoom-in-95 duration-200"
      >
        <div className="w-16 h-16 bg-neutral-800 rounded-full flex items-center justify-center mx-auto mb-4 border border-neutral-700">
           <svg className="w-8 h-8 text-neutral-400" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
        </div>
        
        <h3 className="mb-2 text-xl font-bold text-white tracking-tight">
          {title}
        </h3>
        
        <p className="mb-6 text-sm text-neutral-400 leading-relaxed">
          {message}
        </p>
        
        <button
          onClick={onClose}
          autoFocus
          className="w-full py-3 bg-primary hover:bg-blue-500 text-white font-medium rounded-xl transition-all shadow-[0_0_20px_-5px_rgba(37,99,235,0.4)]"
        >
          Got it
        </button>
      </div>
    </div>
  )
}
