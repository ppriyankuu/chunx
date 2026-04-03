interface Props {
  progress: number  // 0–1
  label?: string
}

export function ProgressBar({ progress, label }: Props) {
  const percent = Math.round(progress * 100)

  return (
    <div style={{ marginTop: 16 }}>
      {label && (
        <p style={{ margin: '0 0 8px', fontSize: 14, color: '#374151' }}>
          {label}
        </p>
      )}
      <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          width: `${percent}%`,
          height: '100%',
          background: '#16a34a',
          transition: 'width 0.2s',
        }} />
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 14, color: '#6b7280', textAlign: 'right' }}>
        {percent}%
      </p>
    </div>
  )
}