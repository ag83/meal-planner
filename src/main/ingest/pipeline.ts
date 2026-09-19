import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import type Database from 'better-sqlite3'
import { hashFile } from '../services/hasher'
import { makeThumbnail } from '../services/thumbnailer'
import { runOcr } from '../ocr/worker'
import { extractTags } from '../tags/matcher'
import type { IngestProgress } from '../../shared/types'

export type { IngestProgress }
export type ProgressCallback = (p: IngestProgress) => void

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp'])

const generateId = (): string => {
  return crypto.randomBytes(9).toString('base64url')
}

export const ingestFile = async (
  db: Database.Database,
  vaultPath: string,
  srcPath: string,
  onProgress: ProgressCallback
): Promise<void> => {
  const ext = path.extname(srcPath).slice(1).toLowerCase()
  if (!IMAGE_EXTS.has(ext)) {
    onProgress({ filePath: srcPath, status: 'error', error: `Unsupported type: .${ext}` })
    return
  }

  onProgress({ filePath: srcPath, status: 'hashing' })
  let sha256: string
  try {
    sha256 = await hashFile(srcPath)
  } catch (err) {
    onProgress({ filePath: srcPath, status: 'error', error: String(err) })
    return
  }

  const dup = db.prepare<[string], { id: string }>('SELECT id FROM recipes WHERE sha256 = ?').get(sha256)
  if (dup) {
    onProgress({ filePath: srcPath, status: 'duplicate', recipeId: dup.id })
    return
  }

  const id = generateId()
  const picturesDir = path.join(vaultPath, 'pictures')
  const thumbsDir = path.join(vaultPath, 'thumbs')
  const destPath = path.join(picturesDir, `${id}.${ext}`)

  onProgress({ filePath: srcPath, status: 'copying' })
  try {
    await fs.copyFile(srcPath, destPath)
  } catch (err) {
    onProgress({ filePath: srcPath, status: 'error', error: String(err) })
    return
  }

  onProgress({ filePath: srcPath, status: 'thumbnail' })
  let width = 0,
    height = 0,
    bytes = 0
  try {
    const meta = await makeThumbnail(destPath, thumbsDir, id)
    width = meta.width
    height = meta.height
    bytes = meta.bytes
  } catch (err) {
    onProgress({ filePath: srcPath, status: 'error', error: `Thumbnail failed: ${err}` })
    await fs.unlink(destPath).catch(() => undefined)
    return
  }

  onProgress({ filePath: srcPath, status: 'ocr' })
  let ocrText = ''
  let ocrConf = 0
  let ocrLang = ''
  try {
    const result = await runOcr(destPath)
    ocrText = result.text
    ocrConf = result.confidence
    ocrLang = result.lang
  } catch (err) {
    // OCR failure is non-fatal — recipe is still saved without text
    console.warn(`[ingest] OCR failed for ${id}:`, err)
  }

  onProgress({ filePath: srcPath, status: 'tagging' })
  const matches = extractTags(db, ocrText)

  const now = Date.now()
  db.transaction(() => {
    db.prepare(`
      INSERT INTO recipes (id, ext, sha256, width, height, bytes, ocr_lang, ocr_text, ocr_conf, created_at, updated_at)
      VALUES (@id, @ext, @sha256, @width, @height, @bytes, @ocrLang, @ocrText, @ocrConf, @now, @now)
    `).run({ id, ext, sha256, width, height, bytes, ocrLang, ocrText, ocrConf, now })

    const insertTag = db.prepare(
      "INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id, confidence, source) VALUES (@recipeId, @tagId, @confidence, 'ocr')"
    )
    for (const { tagId, confidence } of matches) {
      insertTag.run({ recipeId: id, tagId, confidence })
    }
  })()

  onProgress({ filePath: srcPath, status: 'done', recipeId: id })
}
