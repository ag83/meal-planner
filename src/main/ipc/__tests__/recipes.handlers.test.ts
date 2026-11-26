import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IngestProgress, RecipeFull, RecipeSummary } from '../../../shared/types'
import {
  electronModule,
  invoke,
  makeTempDir,
  paths,
  sentToRenderer
} from '../../__tests__/electronMock'
import { closeDb, getDb } from '../../db/connection'
import { runOcr } from '../../ocr/worker'
import { vaultManager } from '../../vault/manager'
import { registerRecipeHandlers } from '../recipes'

vi.mock('electron', async () => (await import('../../__tests__/electronMock')).electronModule)
vi.mock('../../ocr/worker', () => ({ OCR_LANG: 'ru', runOcr: vi.fn() }))

let root: string
let vaultPath: string

const tagId = (label: string): number =>
  (getDb().prepare('SELECT id FROM tags WHERE label=?').get(label) as { id: number }).id

const insertRecipe = (id: string, createdAt: number, missing = 0): void => {
  getDb()
    .prepare(
      'INSERT INTO recipes (id,ext,sha256,width,height,created_at,updated_at,missing) VALUES (?,?,?,?,?,?,?,?)'
    )
    .run(id, 'jpg', id, 10, 10, createdAt, createdAt, missing)
}

const recipeTags = async (id: string): Promise<RecipeFull['tags']> =>
  (await invoke<RecipeFull>('recipes:get', id)).tags

describe('recipe handlers without a vault', () => {
  beforeAll(() => registerRecipeHandlers())

  it('returns empty results', async () => {
    await expect(invoke('recipes:list')).resolves.toEqual([])
    await expect(invoke('recipes:filterByTags', [1], 'and')).resolves.toEqual([])
    await expect(invoke('recipes:get', 'x')).resolves.toBeNull()
  })

  it.each([
    ['recipes:reOcr', 'x'],
    ['recipes:delete', 'x'],
    ['recipes:ingest', []]
  ])('%s rejects', async (channel, arg) => {
    await expect(invoke(channel, arg)).rejects.toThrow('No vault open')
  })
})

describe('recipe handlers', () => {
  beforeAll(async () => {
    registerRecipeHandlers()
    root = await makeTempDir()
    paths.userData = root
    vaultPath = path.join(root, 'vault')
    await vaultManager.open(vaultPath)
  })

  afterAll(async () => {
    closeDb()
    await fs.rm(root, { recursive: true, force: true })
  })

  beforeEach(() => {
    vi.mocked(runOcr).mockReset()
    getDb().prepare('DELETE FROM recipes').run()
    insertRecipe('older', 1000)
    insertRecipe('newer', 2000)
    insertRecipe('gone', 3000, 1)
  })

  it('lists present recipes newest first with tag counts', async () => {
    await invoke('recipes:setTag', 'older', tagId('Курица'), true)
    const list = await invoke<RecipeSummary[]>('recipes:list')
    expect(list.map((r) => [r.id, r.tagCount])).toEqual([
      ['newer', 0],
      ['older', 1]
    ])
  })

  it('filters by tags in AND and OR modes', async () => {
    const chicken = tagId('Курица')
    const liver = tagId('Печень')
    await invoke('recipes:setTag', 'older', chicken, true)
    await invoke('recipes:setTag', 'older', liver, true)
    await invoke('recipes:setTag', 'newer', chicken, true)

    const ids = async (mode: string): Promise<string[]> =>
      (await invoke<RecipeSummary[]>('recipes:filterByTags', [chicken, liver], mode)).map(
        (r) => r.id
      )
    await expect(ids('and')).resolves.toEqual(['older'])
    await expect(ids('or')).resolves.toEqual(['newer', 'older'])
    await expect(invoke('recipes:filterByTags', [], 'or')).resolves.toEqual([])
  })

  it('validates arguments', async () => {
    await expect(invoke('recipes:filterByTags', ['a'], 'and')).rejects.toThrow('Invalid tagIds')
    await expect(invoke('recipes:filterByTags', [1], 'xor')).rejects.toThrow('Invalid mode')
    await expect(invoke('recipes:get', 1)).rejects.toThrow('Invalid id')
    await expect(invoke('recipes:update', 1, {})).rejects.toThrow('Invalid id')
    await expect(invoke('recipes:setTag', 1, 1, true)).rejects.toThrow('Invalid id')
    await expect(invoke('recipes:setTag', 'a', 'b', true)).rejects.toThrow('Invalid tagId')
    await expect(invoke('recipes:setTag', 'a', 1, 'yes')).rejects.toThrow('Invalid on')
    await expect(invoke('recipes:reOcr', 1)).rejects.toThrow('Invalid id')
    await expect(invoke('recipes:delete', 1)).rejects.toThrow('Invalid id')
    await expect(invoke('recipes:ingest', [1])).rejects.toThrow('Invalid paths')
  })

  it('returns null for an unknown recipe', async () => {
    await expect(invoke('recipes:get', 'nope')).resolves.toBeNull()
  })

  it('updates title and notes, clearing omitted fields', async () => {
    await invoke('recipes:update', 'older', { title: 'Борщ', notes: 'вкусно' })
    await expect(invoke('recipes:get', 'older')).resolves.toMatchObject({
      title: 'Борщ',
      notes: 'вкусно'
    })
    await invoke('recipes:update', 'older', {})
    await expect(invoke('recipes:get', 'older')).resolves.toMatchObject({
      title: null,
      notes: null
    })
  })

  it('suppresses a removed OCR tag but not a removed user tag', async () => {
    const chicken = tagId('Курица')
    const liver = tagId('Печень')
    getDb()
      .prepare("INSERT INTO recipe_tags (recipe_id,tag_id,confidence,source) VALUES (?,?,1,'ocr')")
      .run('older', chicken)
    await invoke('recipes:setTag', 'older', liver, true)

    await invoke('recipes:setTag', 'older', chicken, false)
    await invoke('recipes:setTag', 'older', liver, false)

    expect(getDb().prepare('SELECT tag_id FROM recipe_tag_suppressions').all()).toEqual([
      { tag_id: chicken }
    ])
    await expect(recipeTags('older')).resolves.toEqual([])

    await invoke('recipes:setTag', 'older', chicken, true)
    expect(getDb().prepare('SELECT * FROM recipe_tag_suppressions').all()).toEqual([])
  })

  it('re-runs OCR, keeping user tags and honouring suppressions', async () => {
    const chicken = tagId('Курица')
    const liver = tagId('Печень')
    getDb()
      .prepare('INSERT INTO recipe_tag_suppressions (recipe_id,tag_id) VALUES (?,?)')
      .run('older', chicken)
    await invoke('recipes:setTag', 'older', tagId('Курага'), true)
    vi.mocked(runOcr).mockResolvedValue({ text: 'курица и печень', confidence: 88 })

    await invoke('recipes:reOcr', 'older')

    expect(runOcr).toHaveBeenCalledWith(path.join(vaultPath, 'pictures', 'older.jpg'))
    await expect(invoke('recipes:get', 'older')).resolves.toMatchObject({
      ocrText: 'курица и печень',
      ocrLang: 'ru',
      ocrConf: 88
    })
    const ids = (await recipeTags('older')).map((t) => t.tagId)
    expect(ids).toContain(liver)
    expect(ids).toContain(tagId('Курага'))
    expect(ids).not.toContain(chicken)
  })

  it('rejects re-OCR of an unknown recipe', async () => {
    await expect(invoke('recipes:reOcr', 'nope')).rejects.toThrow('Recipe not found')
  })

  it('deletes the row and its files, tolerating missing files', async () => {
    const picture = path.join(vaultPath, 'pictures', 'older.jpg')
    await fs.writeFile(picture, 'x')

    await invoke('recipes:delete', 'older')
    await invoke('recipes:delete', 'older')

    await expect(fs.access(picture)).rejects.toThrow()
    await expect(invoke('recipes:get', 'older')).resolves.toBeNull()
  })

  it('returns picked files, or nothing when cancelled', async () => {
    electronModule.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['a.jpg']
    })
    await expect(invoke('recipes:pickFiles')).resolves.toEqual(['a.jpg'])
    electronModule.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await expect(invoke('recipes:pickFiles')).resolves.toEqual([])
  })

  it('ingests files and reports progress to the window', async () => {
    const source = path.join(root, 'photo.png')
    await sharp({ create: { width: 20, height: 10, channels: 3, background: '#fff' } })
      .png()
      .toFile(source)
    vi.mocked(runOcr).mockResolvedValue({ text: 'курица', confidence: 90 })

    await invoke('recipes:ingest', [source])

    const statuses = sentToRenderer.mock.calls.map(([, p]) => (p as IngestProgress).status)
    expect(statuses.at(-1)).toBe('done')
    await expect(invoke<RecipeSummary[]>('recipes:list')).resolves.toHaveLength(3)
  })
})
