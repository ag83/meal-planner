import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { vault, tags } from '../lib/ipc'
import { useSettingsStore } from '../stores/useSettingsStore'
import type { TagWithAliases, TagKind, TagAlias, Settings } from '../../../shared/types'

// ── Kind labels ───────────────────────────────────────────────────────────────

const KIND_LABEL: Record<TagKind, string> = {
  ingredient: 'Ingredient',
  dish_type: 'Dish type',
  cuisine: 'Cuisine',
  user: 'Custom'
}

const KIND_ORDER: TagKind[] = ['ingredient', 'dish_type', 'cuisine', 'user']

const KIND_BADGE: Record<TagKind, string> = {
  ingredient: 'bg-emerald-100 text-emerald-700',
  dish_type: 'bg-amber-100 text-amber-700',
  cuisine: 'bg-sky-100 text-sky-700',
  user: 'bg-violet-100 text-violet-700'
}

// ── Alias row ─────────────────────────────────────────────────────────────────

function AliasItem({
  alias,
  onRemove
}: {
  alias: TagAlias
  onRemove: (id: number) => void
}): React.JSX.Element {
  return (
    <li className="flex items-center justify-between py-0.5">
      <span className={`font-mono text-xs ${alias.disabled ? 'text-stone-300 line-through' : 'text-stone-600'}`}>
        {alias.lemma}
        {alias.isPrimary && (
          <span className="ml-1 text-stone-400">(primary)</span>
        )}
        {alias.source === 'user' && !alias.isPrimary && (
          <span className="ml-1 text-violet-400">(custom)</span>
        )}
      </span>
      {!alias.isPrimary && !alias.disabled && (
        <button
          onClick={() => onRemove(alias.id)}
          className="ml-2 text-xs text-stone-300 hover:text-red-500"
          title="Remove alias"
        >
          ✕
        </button>
      )}
    </li>
  )
}

// ── Tag row ───────────────────────────────────────────────────────────────────

function TagRow({
  tag,
  onUpdated,
  onDeleted
}: {
  tag: TagWithAliases
  onUpdated: (updated: TagWithAliases) => void
  onDeleted: (id: number) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [addingAlias, setAddingAlias] = useState(false)
  const [aliasInput, setAliasInput] = useState('')
  const [aliasError, setAliasError] = useState('')
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelInput, setLabelInput] = useState(tag.label)

  const handleToggleDisable = useCallback(async () => {
    await tags.update(tag.id, { disabled: !tag.disabled })
    onUpdated({ ...tag, disabled: !tag.disabled })
  }, [tag, onUpdated])

  const handleDelete = useCallback(async () => {
    await tags.delete(tag.id)
    onDeleted(tag.id)
  }, [tag.id, onDeleted])

  const handleLabelSave = useCallback(async () => {
    if (!labelInput.trim() || labelInput.trim() === tag.label) {
      setLabelInput(tag.label)
      setEditingLabel(false)
      return
    }
    await tags.update(tag.id, { label: labelInput.trim() })
    onUpdated({ ...tag, label: labelInput.trim() })
    setEditingLabel(false)
  }, [tag, labelInput, onUpdated])

  const handleAddAlias = useCallback(async () => {
    const surface = aliasInput.trim()
    if (!surface) return
    setAliasError('')
    try {
      await tags.addAlias(tag.id, surface)
      const updated = await tags.list()
      const found = updated.find((t) => t.id === tag.id)
      if (found) onUpdated(found)
      setAliasInput('')
      setAddingAlias(false)
    } catch (err) {
      setAliasError((err as Error).message)
    }
  }, [tag.id, aliasInput, onUpdated])

  const handleRemoveAlias = useCallback(
    async (aliasId: number) => {
      await tags.removeAlias(aliasId)
      onUpdated({ ...tag, aliases: tag.aliases.filter((a) => a.id !== aliasId) })
    },
    [tag, onUpdated]
  )

  return (
    <div className={`border-b border-stone-100 last:border-0 ${tag.disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2 py-2 px-3 hover:bg-stone-50">
        {/* Label */}
        {editingLabel ? (
          <input
            autoFocus
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            onBlur={handleLabelSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleLabelSave()
              if (e.key === 'Escape') { setLabelInput(tag.label); setEditingLabel(false) }
            }}
            className="flex-1 rounded border border-stone-300 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-stone-400"
          />
        ) : (
          <span
            className="flex-1 cursor-pointer text-sm text-stone-800 hover:text-stone-600"
            onDoubleClick={() => setEditingLabel(true)}
            title="Double-click to edit"
          >
            {tag.label}
          </span>
        )}

        {/* Kind badge */}
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_BADGE[tag.kind as TagKind]}`}>
          {KIND_LABEL[tag.kind as TagKind]}
        </span>

        {/* Recipe count */}
        <span className="w-8 text-right text-xs text-stone-400">{tag.recipeCount}</span>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-stone-300 hover:text-stone-600"
          title="Show aliases"
        >
          {expanded ? '▲' : '▼'}
        </button>

        {/* Disable / enable */}
        <button
          onClick={handleToggleDisable}
          className={`text-xs ${tag.disabled ? 'text-emerald-500 hover:text-emerald-700' : 'text-stone-300 hover:text-amber-500'}`}
          title={tag.disabled ? 'Enable' : 'Disable'}
        >
          {tag.disabled ? 'Enable' : 'Disable'}
        </button>

        {/* Delete (user tags only) */}
        {tag.source === 'user' && (
          <button
            onClick={handleDelete}
            className="text-xs text-stone-300 hover:text-red-500"
            title="Delete tag"
          >
            Delete
          </button>
        )}
      </div>

      {/* Aliases panel */}
      {expanded && (
        <div className="border-t border-stone-100 bg-stone-50 px-6 py-2">
          <ul className="mb-2 space-y-0.5">
            {tag.aliases.map((a) => (
              <AliasItem key={a.id} alias={a} onRemove={handleRemoveAlias} />
            ))}
          </ul>

          {addingAlias ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={aliasInput}
                onChange={(e) => { setAliasInput(e.target.value); setAliasError('') }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddAlias()
                  if (e.key === 'Escape') { setAddingAlias(false); setAliasInput(''); setAliasError('') }
                }}
                placeholder="e.g. томат"
                className="flex-1 rounded border border-stone-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-stone-300"
              />
              <button
                onClick={handleAddAlias}
                className="rounded bg-stone-700 px-2 py-1 text-xs text-white hover:bg-stone-600"
              >
                Add
              </button>
              <button
                onClick={() => { setAddingAlias(false); setAliasInput(''); setAliasError('') }}
                className="text-xs text-stone-400 hover:text-stone-600"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAddingAlias(true)}
              className="text-xs text-stone-400 hover:text-stone-700"
            >
              + Add alias
            </button>
          )}

          {aliasError && (
            <p className="mt-1 text-xs text-red-500">{aliasError}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Add tag form ──────────────────────────────────────────────────────────────

function AddTagForm({ onCreated }: { onCreated: (tag: TagWithAliases) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<TagKind>('ingredient')
  const [aliasInput, setAliasInput] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = useCallback(async () => {
    if (!label.trim()) { setError('Label is required'); return }
    setSaving(true)
    setError('')
    try {
      const aliases = aliasInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const id = await tags.create({ label: label.trim(), kind, aliases })
      const allTags = await tags.list()
      const created = allTags.find((t) => t.id === id)
      if (created) onCreated(created)
      setLabel('')
      setAliasInput('')
      setOpen(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }, [label, kind, aliasInput, onCreated])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 text-sm text-stone-400 hover:text-stone-700"
      >
        + Add new tag
      </button>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-stone-200 bg-white p-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-stone-400">New tag</p>
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            autoFocus
            value={label}
            onChange={(e) => { setLabel(e.target.value); setError('') }}
            placeholder="Label (e.g. Авокадо)"
            className="flex-1 rounded-lg border border-stone-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-300"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as TagKind)}
            className="rounded-lg border border-stone-200 px-2 py-1.5 text-sm focus:outline-none"
          >
            {KIND_ORDER.map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
        </div>
        <input
          value={aliasInput}
          onChange={(e) => setAliasInput(e.target.value)}
          placeholder="Aliases (comma-separated, e.g. авокадо, avocado)"
          className="w-full rounded-lg border border-stone-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-stone-300"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={() => { setOpen(false); setLabel(''); setAliasInput(''); setError('') }}
            className="rounded-lg px-3 py-1.5 text-sm text-stone-500 hover:bg-stone-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="rounded-lg bg-stone-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Settings ──────────────────────────────────────────────────────────────────

export default function SettingsScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const store = useSettingsStore()

  const [vaultPath, setVaultPath] = useState<string | null>(null)
  const [tagList, setTagList] = useState<TagWithAliases[]>([])
  const [tagsLoading, setTagsLoading] = useState(true)
  const [retagging, setRetagging] = useState(false)
  const [retagResult, setRetagResult] = useState<number | null>(null)
  const [kindFilter, setKindFilter] = useState<TagKind | 'all'>('all')

  useEffect(() => {
    vault.getCurrent().then((v) => setVaultPath(v?.path ?? null))
    if (!store.loaded) store.load()
    tags.list().then((t) => { setTagList(t); setTagsLoading(false) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleThemeChange = useCallback(
    async (theme: Settings['theme']) => {
      await store.update({ theme })
    },
    [store]
  )

  const handleOcrLangChange = useCallback(
    async (ocrLang: string) => {
      await store.update({ ocrLang })
    },
    [store]
  )

  const handleRetagAll = useCallback(async () => {
    setRetagging(true)
    setRetagResult(null)
    try {
      const { updated } = await tags.retagAll()
      setRetagResult(updated)
      // reload tag counts
      const refreshed = await tags.list()
      setTagList(refreshed)
    } finally {
      setRetagging(false)
    }
  }, [])

  const handleTagUpdated = useCallback((updated: TagWithAliases) => {
    setTagList((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
  }, [])

  const handleTagDeleted = useCallback((id: number) => {
    setTagList((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const handleTagCreated = useCallback((tag: TagWithAliases) => {
    setTagList((prev) => [...prev, tag].sort((a, b) =>
      a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label, 'ru')
    ))
  }, [])

  const visibleTags =
    kindFilter === 'all' ? tagList : tagList.filter((t) => t.kind === kindFilter)

  const groupedTags = KIND_ORDER.reduce<Record<TagKind, TagWithAliases[]>>(
    (acc, k) => {
      acc[k] = visibleTags.filter((t) => t.kind === k)
      return acc
    },
    { ingredient: [], dish_type: [], cuisine: [], user: [] }
  )

  return (
    <div className="flex h-screen flex-col bg-stone-50">
      {/* Header */}
      <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-stone-200 bg-white px-5">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800"
        >
          ← Back
        </button>
        <h1 className="text-sm font-semibold text-stone-800">Settings</h1>
        <div className="w-16" />
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-8 p-6">

          {/* ── Vault ── */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-400">Vault</h2>
            <div className="rounded-xl border border-stone-200 bg-white p-4">
              {vaultPath ? (
                <p className="mb-3 break-all font-mono text-xs text-stone-600">{vaultPath}</p>
              ) : (
                <p className="mb-3 text-sm text-stone-400">No vault loaded</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => vault.openFolder()}
                  className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50"
                >
                  Open folder
                </button>
                <button
                  onClick={async () => {
                    const info = await vault.pick()
                    if (info) {
                      setVaultPath(info.path)
                      setTagsLoading(true)
                      const refreshed = await tags.list()
                      setTagList(refreshed)
                      setTagsLoading(false)
                    }
                  }}
                  className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-50"
                >
                  Switch vault…
                </button>
              </div>
            </div>
          </section>

          {/* ── Preferences ── */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-400">Preferences</h2>
            <div className="rounded-xl border border-stone-200 bg-white divide-y divide-stone-100">
              <div className="flex items-center justify-between px-4 py-3">
                <label className="text-sm text-stone-700">Theme</label>
                <select
                  value={store.theme}
                  onChange={(e) => handleThemeChange(e.target.value as Settings['theme'])}
                  className="rounded-lg border border-stone-200 px-2 py-1 text-sm focus:outline-none"
                >
                  <option value="system">System default</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <label className="text-sm text-stone-700">Default OCR language</label>
                <select
                  value={store.ocrLang}
                  onChange={(e) => handleOcrLangChange(e.target.value)}
                  className="rounded-lg border border-stone-200 px-2 py-1 text-sm focus:outline-none"
                >
                  <option value="rus+eng">Russian + English</option>
                  <option value="rus">Russian only</option>
                  <option value="eng">English only</option>
                </select>
              </div>
            </div>
          </section>

          {/* ── Maintenance ── */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-400">Maintenance</h2>
            <div className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-stone-700">Re-tag all recipes</p>
                  <p className="mt-0.5 text-xs text-stone-400">
                    Re-runs the tag matcher over stored OCR text using the current library. No re-OCR.
                  </p>
                  {retagResult !== null && (
                    <p className="mt-1 text-xs text-emerald-600">
                      Done — {retagResult} recipe{retagResult !== 1 ? 's' : ''} updated.
                    </p>
                  )}
                </div>
                <button
                  onClick={handleRetagAll}
                  disabled={retagging}
                  className="ml-4 flex-shrink-0 rounded-lg bg-stone-100 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-200 disabled:opacity-50"
                >
                  {retagging ? 'Running…' : 'Re-tag all'}
                </button>
              </div>
            </div>
          </section>

          {/* ── Tag library ── */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                Tag library
                {!tagsLoading && (
                  <span className="ml-2 font-normal normal-case text-stone-400">
                    ({tagList.length} tags)
                  </span>
                )}
              </h2>
              {/* Kind filter */}
              <div className="flex gap-1">
                {(['all', ...KIND_ORDER] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setKindFilter(k)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                      kindFilter === k
                        ? 'bg-stone-800 text-white'
                        : 'text-stone-500 hover:bg-stone-100'
                    }`}
                  >
                    {k === 'all' ? 'All' : KIND_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>

            {tagsLoading ? (
              <div className="flex h-24 items-center justify-center text-sm text-stone-400">
                Loading…
              </div>
            ) : (
              <div className="space-y-4">
                {KIND_ORDER.map((k) => {
                  if (kindFilter !== 'all' && kindFilter !== k) return null
                  const group = groupedTags[k]
                  if (group.length === 0) return null
                  return (
                    <div key={k} className="rounded-xl border border-stone-200 bg-white overflow-hidden">
                      <div className="border-b border-stone-100 bg-stone-50 px-3 py-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_BADGE[k]}`}>
                          {KIND_LABEL[k]}
                        </span>
                        <span className="ml-2 text-xs text-stone-400">{group.length}</span>
                      </div>
                      {group.map((tag) => (
                        <TagRow
                          key={tag.id}
                          tag={tag}
                          onUpdated={handleTagUpdated}
                          onDeleted={handleTagDeleted}
                        />
                      ))}
                    </div>
                  )
                })}

                <AddTagForm onCreated={handleTagCreated} />
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  )
}
