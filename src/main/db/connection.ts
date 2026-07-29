import Database from 'better-sqlite3'
import path from 'path'
import { runMigrations } from './migrations'

let db: Database.Database | null = null
let currentVaultPath: string | null = null

export const getDb = (): Database.Database => {
  if (!db) throw new Error('Database not initialized. Call initDb first.')
  return db
}

export const initDb = (vaultPath: string): Database.Database => {
  if (db && currentVaultPath === vaultPath) return db
  db?.close()
  db = new Database(path.join(vaultPath, 'meal-planner.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  currentVaultPath = vaultPath
  return db
}

export const closeDb = (): void => {
  db?.close()
  db = null
  currentVaultPath = null
}
