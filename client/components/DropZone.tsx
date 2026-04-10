import { useRef, useState, DragEvent, ChangeEvent } from 'react'
import { Modal } from './Modal'

interface Props {
  onFileSelected: (file: File) => void
  disabled?: boolean
}

export function DropZone({ onFileSelected, disabled }: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const [showMultiModal, setShowMultiModal] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) setIsDragging(true)
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (disabled) return

    const files = e.dataTransfer.files
    if (files.length > 1) {
      setShowMultiModal(true)
      return
    }
    if (files.length === 1) onFileSelected(files[0])
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (files && files.length > 1) {
      setShowMultiModal(true)
    } else if (files?.[0]) {
      onFileSelected(files[0])
    }
    e.target.value = ''
  }

  const borderClass = isDragging ? 'border-primary' : 'border-neutral-700/50 hover:border-neutral-500'
  const bgClass = isDragging ? 'bg-primary/10' : 'bg-neutral-800/20 hover:bg-neutral-800/40'
  const disabledClass = disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'

  return (
    <>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`relative overflow-hidden border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300 select-none backdrop-blur-sm ${borderClass} ${bgClass} ${disabledClass}`}
      >
        <div className="relative z-10 flex flex-col items-center justify-center space-y-4">
          <div className={`p-4 rounded-full bg-neutral-800/50 mb-2 transition-transform duration-300 ${isDragging ? 'scale-110' : 'scale-100'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-400">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" x2="12" y1="3" y2="15"/>
            </svg>
          </div>
          <p className="text-lg font-medium text-neutral-200">
            {isDragging ? 'Drop it here!' : 'Drag a file here, or click to browse'}
          </p>
          <p className="text-sm text-neutral-500 font-medium">
            Supports files of any size • End-to-end encrypted
          </p>
        </div>
        
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={handleChange}
          disabled={disabled}
        />
      </div>

      {showMultiModal && (
        <Modal
          title="One file at a time, please!"
          message="Chunx only handles one file per transfer. Drop or select a single file and we'll get it across fast."
          onClose={() => setShowMultiModal(false)}
        />
      )}
    </>
  )
}