import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IngestProgress } from '../../../shared/types'
import { makeTempDir, paths } from '../../__tests__/electronMock'
import { closeDb, getDb } from '../../db/connection'
import { runOcr } from '../../ocr/worker'
import { vaultManager } from '../../vault/manager'
import { ingestFile } from '../pipeline'

vi.mock('electron', async () => (await import('../../__tests__/electronMock')).electronModule)
vi.mock('../../ocr/worker', () => ({ OCR_LANG: 'ru', runOcr: vi.fn() }))

// libvips caches open files, which stops Windows from deleting the temp vault.
sharp.cache(false)

let root: string
let vaultPath: string
let source: string

const ingest = async (srcPath: string, target = vaultPath): Promise<IngestProgress[]> => {
  const events: IngestProgress[] = []
  await ingestFile(getDb(), target, srcPath, (p) => events.push(p))
  return events
}

const recipeRows = (): Record<string, unknown>[] =>
  getDb().prepare('SELECT * FROM recipes').all() as Record<string, unknown>[]

beforeEach(async () => {
  root = await makeTempDir()
  paths.userData = root
  vaultPath = path.join(root, 'vault')
  await vaultManager.open(vaultPath)
  source = path.join(root, 'photo.JPG')
  await sharp({ create: { width: 800, height: 600, channels: 3, background: '#eee' } })
    .jpeg()
    .toFile(source)
  vi.mocked(runOcr).mockReset().mockResolvedValue({ text: 'курица', confidence: 77 })
})

afterEach(async () => {
  closeDb()
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true })
})

describe('ingestFile', () => {
  it('copies, thumbnails, tags and stores the recipe', async () => {
    const events = await ingest(source)

    expect(events.map((e) => e.status)).toEqual([
      'hashing',
      'copying',
      'thumbnail',
      'ocr',
      'tagging',
      'done'
    ])
    const [row] = recipeRows()
    expect(row).toMatchObject({
      ext: 'jpg',
      width: 800,
      height: 600,
      ocr_text: 'курица',
      ocr_lang: 'ru',
      ocr_conf: 77
    })
    const thumb = await sharp(path.join(vaultPath, 'thumbs', `${row.id}.webp`)).metadata()
    expect(thumb.width).toBe(512)
    await expect(
      fs.access(path.join(vaultPath, 'pictures', `${row.id}.jpg`))
    ).resolves.toBeUndefined()
    expect(getDb().prepare('SELECT source FROM recipe_tags').all()).toContainEqual({
      source: 'ocr'
    })
  })

  it('reports a duplicate without storing it twice', async () => {
    await ingest(source)
    const events = await ingest(source)
    expect(events.at(-1)).toMatchObject({ status: 'duplicate', recipeId: recipeRows()[0].id })
    expect(recipeRows()).toHaveLength(1)
  })

  it('rejects unsupported types', async () => {
    const events = await ingest(path.join(root, 'notes.txt'))
    expect(events).toEqual([expect.objectContaining({ status: 'error' })])
  })

  it('reports an unreadable source', async () => {
    const events = await ingest(path.join(root, 'absent.png'))
    expect(events.at(-1)?.status).toBe('error')
  })

  it('reports a failed copy', async () => {
    const events = await ingest(source, path.join(root, 'no-such-vault'))
    expect(events.at(-1)?.status).toBe('error')
    expect(recipeRows()).toHaveLength(0)
  })

  it('removes the copy when the thumbnail fails', async () => {
    const broken = path.join(root, 'broken.png')
    await fs.writeFile(broken, 'not an image')

    const events = await ingest(broken)

    expect(events.at(-1)?.error).toContain('Thumbnail failed')
    await expect(fs.readdir(path.join(vaultPath, 'pictures'))).resolves.toEqual([])
  })

  it('still saves the recipe when OCR fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(runOcr).mockRejectedValue(new Error('ocr down'))

    const events = await ingest(source)

    expect(events.at(-1)?.status).toBe('done')
    expect(recipeRows()[0]).toMatchObject({ ocr_text: '', ocr_lang: '', ocr_conf: 0 })
  })
})
