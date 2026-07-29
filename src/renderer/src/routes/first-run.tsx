import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { vault } from '../lib/ipc'

const FirstRun = (): React.JSX.Element => {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleChoose = async (): Promise<void> => {
    setError(null)
    setLoading(true)
    try {
      const info = await vault.pick()
      if (info) {
        navigate('/gallery', { replace: true })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open vault folder.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-stone-50">
      <div className="w-full max-w-md px-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-stone-800">Meal Planner</h1>
        <p className="mt-2 text-stone-500">Choose a folder to store your recipe collection.</p>

        <button
          onClick={handleChoose}
          disabled={loading}
          className="mt-8 w-full rounded-lg bg-stone-800 px-6 py-3 font-medium text-white transition-colors hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Opening…' : 'Choose folder'}
        </button>

        {error && (
          <p className="mt-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
        )}

        <p className="mt-6 text-xs leading-relaxed text-stone-400">
          Pick an empty folder to start a new collection, or pick an existing Meal Planner folder
          to pick up where you left off.
        </p>
      </div>
    </div>
  )
}

export default FirstRun
