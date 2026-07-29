import fs from 'fs/promises'
import path from 'path'
import type Database from 'better-sqlite3'

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp'])

export const reconcile = async (db: Database.Database, vaultPath: string): Promise<void> => {
  const picturesDir = path.join(vaultPath, 'pictures')

  let entries: string[]
  try {
    entries = await fs.readdir(picturesDir)
  } catch {
    return // pictures dir not yet created — nothing to reconcile
  }

  const fileSet = new Set(
    entries.filter((f) => IMAGE_EXTS.has(path.extname(f).slice(1).toLowerCase()))
  )

  const rows = db
    .prepare<[], { id: string; ext: string }>('SELECT id, ext FROM recipes')
    .all()

  const markMissing = db.prepare('UPDATE recipes SET missing = 1 WHERE id = ?')
  const markPresent = db.prepare('UPDATE recipes SET missing = 0 WHERE id = ?')

  db.transaction(() => {
    for (const row of rows) {
      const filename = `${row.id}.${row.ext}`
      if (fileSet.has(filename)) {
        markPresent.run(row.id)
        fileSet.delete(filename)
      } else {
        markMissing.run(row.id)
      }
    }
  })()

  // Orphan images (file exists but no DB row) will be ingested in Phase 4.
  for (const orphan of fileSet) {
    console.log(`[reconcile] unregistered image queued for ingest: ${orphan}`)
  }
}
