import { useRef, useState, DragEvent, ChangeEvent } from 'react'

interface Props {
  onFileSelected: (file: File) => void
  disabled?: boolean
}

export function DropZone({ onFileSelected, disabled }: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()  // Required — without this, drop won't fire
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
    
    const file = e.dataTransfer.files[0]
    if (file) onFileSelected(file)
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onFileSelected(file)
    e.target.value = '' // Reset so you can select the same file again later
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      style={{
        border: `2px dashed ${isDragging ? '#6366f1' : '#ccc'}`,
        borderRadius: 12,
        padding: '48px 32px',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: isDragging ? '#eef2ff' : 'transparent',
        transition: 'all 0.15s',
        opacity: disabled ? 0.5 : 1,
        userSelect: 'none',
      }}
    >
      <p style={{ margin: 0, fontSize: 16, color: '#374151' }}>
        {isDragging ? 'Drop it!' : 'Drag a file here, or click to browse'}
      </p>
      <p style={{ margin: '8px 0 0', fontSize: 14, color: '#9ca3af' }}>
        Supports files of any size
      </p>
      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleChange}
        disabled={disabled}
      />
    </div>
  )
}