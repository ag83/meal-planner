import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { runMigrations } from '../../db/migrations'
import { reconcile } from '../reconcile'

let db: Database.Database
let tmpDir: string

beforeEach(async () => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reconcile-test-'))
})

afterEach(async () => {
  db.close()
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function insertRecipe(id: string, ext: string) {
  db.prepare(
    `INSERT INTO recipes (id, ext, sha256, created_at, updated_at) VALUES (?,?,?,1,1)`
  ).run(id, ext, `sha-${id}`)
}

function getMissing(id: string): number {
  return (db.prepare<[string], { missing: number }>('SELECT missing FROM recipes WHERE id=?').get(id) as { missing: number }).missing
}

async function writePicture(filename: string) {
  const dir = path.join(tmpDir, 'pictures')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, filename), 'fake')
}

describe('reconcile', () => {
  it('marks row missing=1 when file is absent', async () => {
    insertRecipe('abc', 'jpg')
    await fs.mkdir(path.join(tmpDir, 'pictures'), { recursive: true })
    await reconcile(db, tmpDir)
    expect(getMissing('abc')).toBe(1)
  })

  it('marks row missing=0 when file is present', async () => {
    insertRecipe('abc', 'jpg')
    await writePicture('abc.jpg')
    await reconcile(db, tmpDir)
    expect(getMissing('abc')).toBe(0)
  })

  it('handles multiple rows — mixed present and absent', async () => {
    insertRecipe('present', 'png')
    insertRecipe('absent', 'jpg')
    await writePicture('present.png')
    await reconcile(db, tmpDir)
    expect(getMissing('present')).toBe(0)
    expect(getMissing('absent')).toBe(1)
  })

  it('ignores non-image files in pictures dir', async () => {
    insertRecipe('abc', 'jpg')
    await writePicture('abc.jpg')
    await writePicture('notes.txt')
    await reconcile(db, tmpDir)
    expect(getMissing('abc')).toBe(0)
  })

  it('does not throw when pictures dir is missing', async () => {
    insertRecipe('abc', 'jpg')
    // No pictures dir created
    await expect(reconcile(db, tmpDir)).resolves.toBeUndefined()
  })

  it('corrects a previously-missing record once file reappears', async () => {
    insertRecipe('abc', 'jpg')
    await fs.mkdir(path.join(tmpDir, 'pictures'), { recursive: true })

    await reconcile(db, tmpDir) // file absent → missing=1
    expect(getMissing('abc')).toBe(1)

    await writePicture('abc.jpg')
    await reconcile(db, tmpDir) // file present → missing=0
    expect(getMissing('abc')).toBe(0)
  })
})
