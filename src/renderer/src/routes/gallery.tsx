import React from 'react'
import { vault } from '../lib/ipc'
import { useNavigate } from 'react-router-dom'

export default function Gallery(): React.JSX.Element {
  const navigate = useNavigate()

  async function handleSwitchVault(): Promise<void> {
    const info = await vault.pick()
    if (info) navigate('/gallery', { replace: true })
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-stone-50">
      <p className="font-mono text-sm text-stone-400">Gallery — Phase 3 coming soon</p>
      <button
        onClick={handleSwitchVault}
        className="text-xs text-stone-400 underline underline-offset-2 hover:text-stone-600"
      >
        Switch vault
      </button>
    </div>
  )
}
