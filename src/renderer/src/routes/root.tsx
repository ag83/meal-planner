import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { vault } from '../lib/ipc'

export default function Root(): React.JSX.Element {
  const navigate = useNavigate()

  useEffect(() => {
    vault.getCurrent().then((info) => {
      navigate(info ? '/gallery' : '/first-run', { replace: true })
    })
  }, [navigate])

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50">
      <span className="text-sm text-stone-400">Loading…</span>
    </div>
  )
}
