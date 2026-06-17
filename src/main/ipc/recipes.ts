import { ipcMain, dialog, BrowserWindow } from 'electron'
import { getDb } from '../db/connection'
import { vaultManager } from '../vault/manager'
import { ingestFile } from '../ingest/pipeline'
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
