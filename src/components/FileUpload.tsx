import { useCallback, useRef, useState } from 'react'

interface Props {
  onFile: (buffer: ArrayBuffer, name: string) => void
  fileName: string | null
}

export function FileUpload({ onFile, fileName }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0]
      if (!file) return
      file.arrayBuffer().then((buf) => onFile(buf, file.name))
    },
    [onFile],
  )

  return (
    <div
      className={`upload-drop ${dragOver ? 'drag-over' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        handleFiles(e.dataTransfer.files)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".gds,.gds2,.gdsii"
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />
      {fileName ? (
        <>
          <div className="upload-title">{fileName}</div>
          <div className="upload-hint">Click or drop to load a different .gds file</div>
        </>
      ) : (
        <>
          <div className="upload-title">Drop a .gds file here</div>
          <div className="upload-hint">or click to browse</div>
        </>
      )}
    </div>
  )
}
