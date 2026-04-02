# Phase 7: UI Components

This phase creates the reusable UI components: the DropZone for file selection and the _app.tsx for StreamSaver setup.

---

## 7.1 Configure _app.tsx for StreamSaver

**File:** `client/src/pages/_app.tsx`

Update this file to set up StreamSaver's service worker:

```typescript
// client/src/pages/_app.tsx

import type { AppProps } from 'next/app'
import { useEffect } from 'react'
import streamSaver from 'streamsaver'

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    // Set the path to StreamSaver's service worker intermediary
    // This MUST be served from the same domain
    streamSaver.mitm = '/mitm.html'
  }, [])

  return <Component {...pageProps} />
}
```

**Why this is needed:**
- StreamSaver uses a service worker to intercept downloads
- The `mitm.html` file must be served from your domain (not a CDN)
- Setting this once in `_app.tsx` makes it available everywhere

---

## 7.2 Create the DropZone Component

**File:** `client/src/components/DropZone.tsx`

Create this file:

```typescript
// client/src/components/DropZone.tsx

import { useRef, useState, DragEvent, ChangeEvent } from 'react'

interface Props {
  onFileSelected: (file: File) => void
  disabled?: boolean
}

export function DropZone({ onFileSelected, disabled }: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // ============================================================================
  // DRAG EVENT HANDLERS
  // ============================================================================

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()  // Required — without this, drop won't fire
    e.stopPropagation()
    if (!disabled) {
      setIsDragging(true)
    }
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    
    // Only clear dragging state if leaving the actual drop zone,
    // not when moving to a child element
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
    if (file) {
      onFileSelected(file)
    }
  }

  // ============================================================================
  // CLICK TO SELECT
  // ============================================================================

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      onFileSelected(file)
    }
    // Reset the input value so the same file can be re-selected
    e.target.value = ''
  }

  // ============================================================================
  // RENDER
  // ============================================================================

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
```

---

## 7.3 Understanding DropZone

### Drag and Drop Events

**handleDragOver:**
```typescript
function handleDragOver(e: DragEvent<HTMLDivElement>) {
  e.preventDefault()  // CRITICAL — required for drop to work
  e.stopPropagation()
  setIsDragging(true)
}
```

- `preventDefault()` is **required** — without it, the browser won't fire the `drop` event
- `stopPropagation()` prevents parent elements from interfering

**handleDragLeave:**
```typescript
function handleDragLeave(e: DragEvent<HTMLDivElement>) {
  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
    setIsDragging(false)
  }
}
```

- Checks if we're actually leaving the drop zone (not just moving to a child element)
- Prevents flickering when dragging over child elements

**handleDrop:**
```typescript
function handleDrop(e: DragEvent<HTMLDivElement>) {
  e.preventDefault()
  const file = e.dataTransfer.files[0]
  if (file) {
    onFileSelected(file)
  }
}
```

- Gets the first file from `dataTransfer.files`
- Calls the parent's `onFileSelected` callback

### Click to Select

```typescript
<input
  ref={inputRef}
  type="file"
  style={{ display: 'none' }}
  onChange={handleChange}
/>
```

- Hidden file input triggered by clicking the drop zone
- `e.target.value = ''` resets it so the same file can be selected again

### Disabled State

```typescript
cursor: disabled ? 'not-allowed' : 'pointer',
opacity: disabled ? 0.5 : 1,
```

- Visual feedback when transfer is in progress
- Prevents interaction during busy states

---

## 7.4 Usage Example

```typescript
function MyPage() {
  function handleFileSelected(file: File) {
    console.log('Selected:', file.name, file.size, 'bytes')
    // ... start sending file
  }

  return (
    <DropZone 
      onFileSelected={handleFileSelected} 
      disabled={isBusy}
    />
  )
}
```

---

## 7.5 Styling Notes

The DropZone uses **inline styles** for simplicity:

- No CSS files to manage
- No Tailwind dependency
- Easy to customize
- Works out of the box

**To customize:**
- Change `border` color for different themes
- Adjust `padding` for larger/smaller drop zone
- Modify `borderRadius` for different corner styles

---

## 7.6 Optional: Create a ProgressBar Component

**File:** `client/src/components/ProgressBar.tsx`

This is optional — you can use inline progress bars. But if you want a reusable component:

```typescript
// client/src/components/ProgressBar.tsx

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
      
      <div style={{ 
        height: 8, 
        background: '#e5e7eb', 
        borderRadius: 4,
        overflow: 'hidden',
      }}>
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
```

---

## 7.7 File Input Accept Attribute (Optional)

If you want to restrict file types:

```typescript
<input
  type="file"
  accept=".jpg,.jpeg,.png,.gif"  // Only images
  // or
  accept="video/*"  // Only videos
  // or
  accept="*"  // All files (default)
/>
```

For this project, we accept **all files**, so no `accept` attribute is needed.

---

## 7.8 Common Mistakes to Avoid

❌ **Forgetting preventDefault in dragOver:**
```typescript
// WRONG - drop event won't fire
function handleDragOver(e: DragEvent) {
  // missing preventDefault
}
```

✅ **Always preventDefault:**
```typescript
// CORRECT
function handleDragOver(e: DragEvent) {
  e.preventDefault()
}
```

❌ **Not resetting file input:**
```typescript
// WRONG - can't select same file twice
function handleChange(e: ChangeEvent<HTMLInputElement>) {
  // ... process file
  // input value not reset
}
```

✅ **Reset after selection:**
```typescript
// CORRECT
function handleChange(e: ChangeEvent<HTMLInputElement>) {
  // ... process file
  e.target.value = ''  // Allow re-selection
}
```

❌ **Forgetting to set mitm.html:**
```typescript
// WRONG - StreamSaver won't work
// streamSaver.mitm is not set
```

✅ **Set in _app.tsx:**
```typescript
// CORRECT
useEffect(() => {
  streamSaver.mitm = '/mitm.html'
}, [])
```

❌ **Using blob binaryType in DataChannel:**
```typescript
// WRONG - breaks synchronous message handling
dc.binaryType = 'blob'
```

✅ **Use arraybuffer:**
```typescript
// CORRECT
dc.binaryType = 'arraybuffer'
```

---

## 7.9 Checklist

Before moving to Phase 8, verify:

- [ ] `client/src/pages/_app.tsx` is updated with `streamSaver.mitm`
- [ ] `client/src/components/DropZone.tsx` exists
- [ ] `client/public/mitm.html` exists
- [ ] No TypeScript errors
- [ ] DropZone visual styles look correct
- [ ] You understand why preventDefault is required in dragOver
- [ ] You understand why we reset the file input value

---

**Next Phase:** [Phase 8 - Home Page](./PHASE_08_HOME_PAGE.md)
