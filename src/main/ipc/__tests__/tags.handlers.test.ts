import fs from 'fs/promises'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { TagSuggestion, TagWithAliases } from '../../../shared/types'
import { invoke, makeTempDir, paths } from '../../__tests__/electronMock'
import { closeDb, getDb } from '../../db/connection'
import { vaultManager } from '../../vault/manager'
import { registerTagHandlers } from '../tags'

vi.mock('electron', async () => (await import('../../__tests__/electronMock')).electronModule)

let root: string

const allTags = (kind?: string): Promise<TagWithAliases[]> => invoke('tags:list', kind)

const findTag = async (label: string): Promise<TagWithAliases> => {
  const tag = (await allTags()).find((t) => t.label === label)
  if (!tag) throw new Error(`No tag ${label}`)
  return tag
}

describe('tag handlers without a vault', () => {
  beforeAll(() => registerTagHandlers())

  it('returns empty results', async () => {
    await expect(invoke('tags:suggest', 'кур')).resolves.toEqual([])
    await expect(invoke('tags:list')).resolves.toEqual([])
    await expect(invoke('tags:retagAll')).resolves.toEqual({ updated: 0 })
  })
})

describe('tag handlers', () => {
  beforeAll(async () => {
    registerTagHandlers()
    root = await makeTempDir()
    paths.userData = root
    await vaultManager.open(path.join(root, 'vault'))
  })

  afterAll(async () => {
    closeDb()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('suggests canonical labels for a prefix and respects the limit', async () => {
    const found = await invoke<TagSuggestion[]>('tags:suggest', 'кур')
    expect(found.map((t) => t.label)).toContain('Курица')
    await expect(invoke('tags:suggest', 'кур', 1)).resolves.toHaveLength(1)
  })

  it.each([[''], ['   '], [5], ['!!!']])('suggests nothing for %j', async (prefix) => {
    await expect(invoke('tags:suggest', prefix)).resolves.toEqual([])
  })

  it('lists tags, optionally by kind', async () => {
    const ingredients = await allTags('ingredient')
    expect(ingredients.length).toBeGreaterThan(0)
    expect(ingredients.every((t) => t.kind === 'ingredient')).toBe(true)
    expect(ingredients[0].aliases.length).toBeGreaterThan(0)
    expect((await allTags()).length).toBeGreaterThan(ingredients.length)
  })

  it('creates a user tag with a primary and extra aliases', async () => {
    const id = await invoke<number>('tags:create', {
      label: ' Авокадо ',
      kind: 'user',
      aliases: ['авокадо', 'avocado', '!!!']
    })
    const tag = (await allTags()).find((t) => t.id === id)
    expect(tag).toMatchObject({ label: 'Авокадо', source: 'user', disabled: false })
    expect(tag?.aliases.filter((a) => a.isPrimary)).toHaveLength(1)
    expect(tag?.aliases).toHaveLength(2)
  })

  it('creates a tag whose label normalizes to nothing without a primary alias', async () => {
    const id = await invoke<number>('tags:create', { label: '!!!', kind: 'user' })
    expect((await allTags()).find((t) => t.id === id)?.aliases).toEqual([])
  })

  it.each([
    [null, 'Invalid input'],
    [{ label: ' ', kind: 'user' }, 'Label is required'],
    [{ label: 'x', kind: 'bad' }, 'Invalid kind']
  ])('rejects creating %j', async (input, message) => {
    await expect(invoke('tags:create', input)).rejects.toThrow(message)
  })

  it('updates label, kind and disabled state', async () => {
    const id = await invoke<number>('tags:create', { label: 'Кинза', kind: 'user' })
    await invoke('tags:update', id, { label: ' Кориандр ', kind: 'ingredient', disabled: true })
    expect((await allTags()).find((t) => t.id === id)).toMatchObject({
      label: 'Кориандр',
      kind: 'ingredient',
      disabled: true
    })
    await invoke('tags:update', id, { disabled: false })
    expect((await allTags()).find((t) => t.id === id)?.disabled).toBe(false)
    await expect(invoke('tags:update', id, { label: ' ' })).rejects.toThrow('Label cannot be empty')
    await expect(invoke('tags:update', 'x', {})).rejects.toThrow('Invalid tag id')
    await expect(invoke('tags:update', id, null)).rejects.toThrow('Invalid patch')
  })

  it('adds aliases and refuses ones owned by another tag', async () => {
    const chicken = await findTag('Курица')
    const liver = await findTag('Печень')
    await invoke('tags:addAlias', chicken.id, 'цыпленок табака')
    expect((await findTag('Курица')).aliases.length).toBe(chicken.aliases.length + 1)

    await expect(invoke('tags:addAlias', liver.id, 'цыпленок табака')).rejects.toThrow(
      'already assigned'
    )
    await expect(invoke('tags:addAlias', 'x', 'a')).rejects.toThrow('Invalid tag id')
    await expect(invoke('tags:addAlias', chicken.id, ' ')).rejects.toThrow('Invalid alias')
    await expect(invoke('tags:addAlias', chicken.id, '!!!')).rejects.toThrow('empty string')
  })

  it('disables builtin aliases, deletes user ones and protects the primary', async () => {
    const chicken = await findTag('Курица')
    await invoke('tags:addAlias', chicken.id, 'пулярка')
    const { aliases } = await findTag('Курица')
    const user = aliases.find((a) => a.source === 'user' && !a.isPrimary)!
    const primary = aliases.find((a) => a.isPrimary)!
    const builtin = (await allTags())
      .flatMap((t) => t.aliases)
      .find((a) => a.source === 'builtin' && !a.isPrimary)!

    await invoke('tags:removeAlias', user.id)
    await invoke('tags:removeAlias', builtin.id)
    await invoke('tags:removeAlias', 999999)
    await expect(invoke('tags:removeAlias', primary.id)).rejects.toThrow('primary alias')
    await expect(invoke('tags:removeAlias', 'x')).rejects.toThrow('Invalid alias id')

    const after = (await allTags()).flatMap((t) => t.aliases)
    expect(after.find((a) => a.id === user.id)).toBeUndefined()
    expect(after.find((a) => a.id === builtin.id)?.disabled).toBe(true)
  })

  it('disables builtin tags and deletes user tags', async () => {
    const builtin = await findTag('Курага')
    const id = await invoke<number>('tags:create', { label: 'Временный', kind: 'user' })

    await invoke('tags:delete', builtin.id)
    await invoke('tags:delete', id)
    await invoke('tags:delete', 999999)
    await expect(invoke('tags:delete', 'x')).rejects.toThrow('Invalid tag id')

    expect((await findTag('Курага')).disabled).toBe(true)
    expect((await allTags()).find((t) => t.id === id)).toBeUndefined()
  })

  it('retags stored OCR text, honouring suppressions', async () => {
    const chicken = await findTag('Курица')
    const liver = await findTag('Печень')
    const insert = getDb().prepare(
      'INSERT INTO recipes (id,ext,sha256,width,height,ocr_text,created_at,updated_at) VALUES (?,?,?,1,1,?,1,1)'
    )
    insert.run('a', 'jpg', 'a', 'курица и печень')
    insert.run('empty', 'jpg', 'empty', '')
    insert.run('none', 'jpg', 'none', null)
    getDb()
      .prepare('INSERT INTO recipe_tag_suppressions (recipe_id,tag_id) VALUES (?,?)')
      .run('a', chicken.id)

    await expect(invoke('tags:retagAll')).resolves.toEqual({ updated: 1 })

    const ids = getDb()
      .prepare("SELECT tag_id AS id FROM recipe_tags WHERE recipe_id='a'")
      .all()
      .map((r) => (r as { id: number }).id)
    expect(ids).toContain(liver.id)
    expect(ids).not.toContain(chicken.id)
  })
})
