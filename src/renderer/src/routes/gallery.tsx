import React, { useState, useEffect, useRef, useCallback } from 'react'
import { vault, recipes } from '../lib/ipc'
import { useNavigate } from 'react-router-dom'
import type { IngestProgress, IngestStatus } from '../../../shared/types'

// Electron sets the `.path` property on File objects from drag-and-drop
interface ElectronFile extends File {
  path: string
}

interface ProgressItem extends IngestProgress {
  fileName: string
}

const STATUS_LABEL: Record<IngestStatus, string> = {
  hashing: 'Hashing…',
  copying: 'Copying…',
  thumbnail: 'Thumbnail…',
  ocr: 'OCR…',
  tagging: 'Tagging…',
  done: 'Done',
  duplicate: 'Duplicate',
  error: 'Error'
}

const STATUS_COLOR: Record<IngestStatus, string> = {
  hashing: 'text-stone-400',
  copying: 'text-stone-400',
  thumbnail: 'text-stone-400',
  ocr: 'text-amber-500',
  tagging: 'text-amber-500',
  done: 'text-emerald-600',
  duplicate: 'text-sky-500',
  error: 'text-red-500'
}

export default function Gallery(): React.JSX.Element {
  const navigate = useNavigate()
  const [isDragging, setIsDragging] = useState(false)
  const [isIngesting, setIsIngesting] = useState(false)
  const [items, setItems] = useState<ProgressItem[]>([])
  const dragCounter = useRef(0)

  useEffect(() => {
    return recipes.onProgress((p) => {
      setItems((prev) => {
        const idx = prev.findIndex((x) => x.filePath === p.filePath)
        const item: ProgressItem = {
          ...p,
          fileName: p.filePath.split(/[/\\]/).pop() ?? p.filePath
        }
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = item
          return next
        }
        return [...prev, item]
      })
    })
  }, [])

  const ingestPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return
      setIsIngesting(true)
      setItems([])
      try {
        await recipes.ingest(paths)
      } finally {
        setIsIngesting(false)
      }
    },
    []
  )

  const handleDragEnter = (e: React.DragEvent): void => {
    e.preventDefault()
    dragCounter.current++
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent): void => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) setIsDragging(false)
  }

  const handleDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
  }

  const handleDrop = useCallback(
    async (e: React.DragEvent): Promise<void> => {
      e.preventDefault()
      dragCounter.current = 0
      setIsDragging(false)
      const paths = Array.from(e.dataTransfer.files)
        .map((f) => (f as ElectronFile).path)
        .filter(Boolean)
      await ingestPaths(paths)
    },
    [ingestPaths]
  )

  const handlePickFiles = useCallback(async (): Promise<void> => {
    const paths = await recipes.pickFiles()
    await ingestPaths(paths)
  }, [ingestPaths])

  async function handleSwitchVault(): Promise<void> {
    const info = await vault.pick()
    if (info) navigate('/gallery', { replace: true })
  }

  const doneCount = items.filter((i) => i.status === 'done').length
  const dupCount = items.filter((i) => i.status === 'duplicate').length
  const errCount = items.filter((i) => i.status === 'error').length

  return (
    <div
      className="relative flex min-h-screen flex-col bg-stone-50"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-white/70 bg-stone-900/60 px-16 py-12 text-center text-white">
            <p className="text-2xl font-semibold">Drop recipes here</p>
            <p className="mt-1 text-sm text-white/70">JPG, PNG or WebP</p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
        <h1 className="text-lg font-semibold text-stone-800">My Recipes</h1>
        <div className="flex items-center gap-4">
          <button
            onClick={handlePickFiles}
            disabled={isIngesting}
            className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {isIngesting ? 'Adding…' : '+ Add Recipes'}
          </button>
          <button
            onClick={handleSwitchVault}
            className="text-xs text-stone-400 underline underline-offset-2 hover:text-stone-600"
          >
            Switch vault
          </button>
        </div>
      </header>

      {/* Main area */}
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
        {items.length === 0 && !isIngesting && (
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-stone-100">
              <svg className="h-8 w-8 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 7a2 2 0 012-2h3l2 3h9a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
            </div>
            <p className="text-stone-500">Drop recipe photos here, or click <strong>+ Add Recipes</strong></p>
            <p className="text-xs text-stone-400">JPG · PNG · WebP — duplicates are skipped automatically</p>
          </div>
        )}

        {/* Progress list */}
        {items.length > 0 && (
          <div className="w-full max-w-lg">
            {!isIngesting && (
              <p className="mb-3 text-sm text-stone-500">
                {doneCount} added{dupCount > 0 ? `, ${dupCount} duplicate${dupCount !== 1 ? 's' : ''}` : ''}
                {errCount > 0 ? `, ${errCount} error${errCount !== 1 ? 's' : ''}` : ''}
              </p>
            )}
            <ul className="space-y-1">
              {items.map((item) => (
                <li
                  key={item.filePath}
                  className="flex items-center justify-between rounded-lg bg-white px-4 py-2 shadow-sm"
                >
                  <span className="truncate text-sm text-stone-700" title={item.filePath}>
                    {item.fileName}
                  </span>
                  <span className={`ml-4 shrink-0 text-xs font-medium ${STATUS_COLOR[item.status]}`}>
                    {STATUS_LABEL[item.status]}
                    {item.error ? ` — ${item.error}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {!isIngesting && (
              <button
                onClick={() => setItems([])}
                className="mt-3 text-xs text-stone-400 underline underline-offset-2 hover:text-stone-600"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
