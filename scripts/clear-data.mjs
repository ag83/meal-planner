#!/usr/bin/env node
// Wipes the active vault's database and all recipe images/thumbnails.
// Reads the vault path from userData/config.json — the same source Electron uses.
import fs from 'fs'
import path from 'path'
import os from 'os'

function getUserDataPath() {
  switch (process.platform) {
    case 'win32': return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'meal-planner')
    case 'darwin': return path.join(os.homedir(), 'Library', 'Application Support', 'meal-planner')
    default: return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'meal-planner')
  }
}

const configPath = path.join(getUserDataPath(), 'config.json')

let config
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
} catch {
  console.error(`No config found at ${configPath} — open the app and pick a vault first.`)
  process.exit(1)
}

const vaultPath = config.vaultPath
if (!vaultPath) {
  console.error('config.json has no vaultPath.')
  process.exit(1)
}

console.log(`Vault: ${vaultPath}`)

// Delete SQLite DB + WAL/SHM sidecar files
for (const suffix of ['', '-wal', '-shm']) {
  const f = path.join(vaultPath, `meal-planner.db${suffix}`)
  try { fs.rmSync(f); console.log(`  deleted ${path.basename(f)}`) } catch { /* absent = fine */ }
}

// Clear pictures/ and thumbs/ directories (keep the dirs)
for (const dir of ['pictures', 'thumbs']) {
  const dirPath = path.join(vaultPath, dir)
  if (!fs.existsSync(dirPath)) continue
  const files = fs.readdirSync(dirPath)
  for (const f of files) fs.rmSync(path.join(dirPath, f))
  console.log(`  cleared ${dir}/ (${files.length} file${files.length !== 1 ? 's' : ''})`)
}

console.log('Done. Restart the app to start fresh.')
