import fs from 'fs/promises'
import path from 'path'
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getDb } from '../db/connection'
import { vaultManager } from '../vault/manager'
import { ingestFile } from '../ingest/pipeline'
import { runOcr } from '../ocr/worker'
import { extractTags } from '../tags/matcher'
import type { IngestProgress } from '../../shared/types'

export function registerRecipeHandlers(): void {
  ipcMain.handle('recipes:list', () => {
    if (!vaultManager.getCurrent()) return []
    const db = getDb()
    return db
      .prepare(`
        SELECT r.id, r.ext, r.title,
               r.width, r.height,
               r.created_at AS createdAt,
               COUNT(rt.tag_id) AS tagCount
        FROM recipes r
        LEFT JOIN recipe_tags rt ON rt.recipe_id = r.id
        WHERE r.missing = 0
        GROUP BY r.id
        ORDER BY r.created_at DESC
      `)
      .all()
  })

  ipcMain.handle('recipes:filterByTags', (_event, tagIds: unknown, mode: unknown) => {
    if (!Array.isArray(tagIds) || tagIds.some((id) => typeof id !== 'number')) {
      throw new Error('Invalid tagIds argument')
    }
    if (mode !== 'and' && mode !== 'or') throw new Error('Invalid mode')
    if (!vaultManager.getCurrent()) return []

    const db = getDb()
    const ids = tagIds as number[]
    if (ids.length === 0) return []

    const ph = ids.map(() => '?').join(',')

    if (mode === 'and') {
      return db
        .prepare(
          `SELECT r.id, r.ext, r.title, r.width, r.height, r.created_at AS createdAt,
                  (SELECT COUNT(*) FROM recipe_tags WHERE recipe_id = r.id) AS tagCount
           FROM recipes r
           WHERE r.missing = 0
             AND r.id IN (
               SELECT recipe_id FROM recipe_tags
               WHERE tag_id IN (${ph})
               GROUP BY recipe_id
               HAVING COUNT(DISTINCT tag_id) = ?
             )
           ORDER BY r.created_at DESC`
        )
        .all([...ids, ids.length])
    } else {
      return db
        .prepare(
          `SELECT DISTINCT r.id, r.ext, r.title, r.width, r.height, r.created_at AS createdAt,
                  (SELECT COUNT(*) FROM recipe_tags WHERE recipe_id = r.id) AS tagCount
           FROM recipes r
           JOIN recipe_tags rt ON rt.recipe_id = r.id
           WHERE r.missing = 0 AND rt.tag_id IN (${ph})
           ORDER BY r.created_at DESC`
        )
        .all(ids)
    }
  })

  ipcMain.handle('recipes:get', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid id')
    if (!vaultManager.getCurrent()) return null
    const db = getDb()
    const recipe = db
      .prepare(
        `SELECT id, ext, title, notes, width, height,
                created_at AS createdAt, updated_at AS updatedAt,
                ocr_text AS ocrText, ocr_lang AS ocrLang, ocr_conf AS ocrConf
         FROM recipes WHERE id = ?`
      )
      .get(id)
    if (!recipe) return null
    const tags = db
      .prepare(
        `SELECT rt.tag_id AS tagId, t.label, t.kind, rt.source, rt.confidence
         FROM recipe_tags rt
         JOIN tags t ON t.id = rt.tag_id
         WHERE rt.recipe_id = ?
         ORDER BY rt.source DESC, t.label ASC`
      )
      .all(id)
    return { ...(recipe as object), tags }
  })

  ipcMain.handle('recipes:update', (_event, id: unknown, patch: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid id')
    const p = patch as { title?: string | null; notes?: string | null }
    getDb()
      .prepare('UPDATE recipes SET title = ?, notes = ?, updated_at = ? WHERE id = ?')
      .run(p.title ?? null, p.notes ?? null, Date.now(), id)
  })

  ipcMain.handle('recipes:setTag', (_event, id: unknown, tagId: unknown, on: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid id')
    if (typeof tagId !== 'number') throw new Error('Invalid tagId')
    if (typeof on !== 'boolean') throw new Error('Invalid on')
    const db = getDb()
    if (on) {
      db.transaction(() => {
        db.prepare(
          'DELETE FROM recipe_tag_suppressions WHERE recipe_id = ? AND tag_id = ?'
        ).run(id, tagId)
        db.prepare(
          "INSERT OR REPLACE INTO recipe_tags (recipe_id,tag_id,confidence,source) VALUES (?,?,1.0,'user')"
        ).run(id, tagId)
      })()
    } else {
      const existing = db
        .prepare<[string, number], { source: string }>(
          'SELECT source FROM recipe_tags WHERE recipe_id = ? AND tag_id = ?'
        )
        .get(id, tagId)
      db.transaction(() => {
        if (existing?.source === 'ocr') {
          db.prepare(
            'INSERT OR IGNORE INTO recipe_tag_suppressions (recipe_id,tag_id) VALUES (?,?)'
          ).run(id, tagId)
        }
        db.prepare('DELETE FROM recipe_tags WHERE recipe_id = ? AND tag_id = ?').run(id, tagId)
      })()
    }
  })

  ipcMain.handle('recipes:reOcr', async (_event, id: unknown, lang: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid id')
    const ocrLang = typeof lang === 'string' ? lang : 'rus+eng'
    const vault = vaultManager.getCurrent()
    if (!vault) throw new Error('No vault open')
    const db = getDb()
    const recipe = db
      .prepare<[string], { ext: string }>('SELECT ext FROM recipes WHERE id = ?')
      .get(id)
    if (!recipe) throw new Error('Recipe not found')

    const imagePath = path.join(vault.path, 'pictures', `${id}.${recipe.ext}`)
    const { text, confidence } = await runOcr(imagePath)
    const matches = extractTags(db, text)

    db.transaction(() => {
      db.prepare('UPDATE recipes SET ocr_text=?,ocr_lang=?,ocr_conf=?,updated_at=? WHERE id=?').run(
        text,
        ocrLang,
        confidence,
        Date.now(),
        id
      )
      db.prepare("DELETE FROM recipe_tags WHERE recipe_id=? AND source='ocr'").run(id)
      const insert = db.prepare(
        "INSERT OR IGNORE INTO recipe_tags (recipe_id,tag_id,confidence,source) VALUES (?,?,?,'ocr')"
      )
      const suppressed = db.prepare(
        'SELECT 1 FROM recipe_tag_suppressions WHERE recipe_id=? AND tag_id=?'
      )
      for (const { tagId, confidence: conf } of matches) {
        if (!suppressed.get(id, tagId)) insert.run(id, tagId, conf)
      }
    })()
  })

  ipcMain.handle('recipes:delete', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid id')
    const vault = vaultManager.getCurrent()
    if (!vault) throw new Error('No vault open')
    const db = getDb()
    const recipe = db
      .prepare<[string], { ext: string }>('SELECT ext FROM recipes WHERE id = ?')
      .get(id)
    if (!recipe) return
    await Promise.all([
      fs.unlink(path.join(vault.path, 'pictures', `${id}.${recipe.ext}`)).catch(() => undefined),
      fs.unlink(path.join(vault.path, 'thumbs', `${id}.webp`)).catch(() => undefined)
    ])
    db.prepare('DELETE FROM recipes WHERE id = ?').run(id)
  })

  ipcMain.handle('recipes:pickFiles', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      title: 'Add Recipes',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      properties: ['openFile', 'multiSelections']
    })
    return canceled ? [] : filePaths
  })

  ipcMain.handle('recipes:ingest', async (event, paths: unknown) => {
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string')) {
      throw new Error('Invalid paths argument')
    }

    const vault = vaultManager.getCurrent()
    if (!vault) throw new Error('No vault open')

    const db = getDb()
    const win = BrowserWindow.fromWebContents(event.sender)

    const sendProgress = (p: IngestProgress): void => {
      win?.webContents.send('ingest:progress', p)
    }

    for (const filePath of paths as string[]) {
      await ingestFile(db, vault.path, filePath, sendProgress)
    }
  })
}
