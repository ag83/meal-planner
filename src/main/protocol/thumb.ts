import fs from 'fs/promises'
import path from 'path'
import { protocol } from 'electron'
import { vaultManager } from '../vault/manager'
import { getDb } from '../db/connection'

// recipe-thumb://thumb/<id>  →  <vault>/thumbs/<id>.webp
// recipe-thumb://full/<id>   →  <vault>/pictures/<id>.<ext>
export function registerThumbProtocol(): void {
  protocol.handle('recipe-thumb', async (request) => {
    const url = new URL(request.url)
    const type = url.hostname  // 'thumb' | 'full'
    const id = url.pathname.slice(1)

    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
      return new Response('Bad request', { status: 400 })
    }

    const vault = vaultManager.getCurrent()
    if (!vault) return new Response('Not found', { status: 404 })

    try {
      if (type === 'full') {
        const row = getDb()
          .prepare<[string], { ext: string }>('SELECT ext FROM recipes WHERE id = ?')
          .get(id)
        if (!row) return new Response('Not found', { status: 404 })
        const ext = row.ext
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
        const data = await fs.readFile(path.join(vault.path, 'pictures', `${id}.${ext}`))
        return new Response(data, { headers: { 'Content-Type': mime } })
      } else {
        const data = await fs.readFile(path.join(vault.path, 'thumbs', `${id}.webp`))
        return new Response(data, { headers: { 'Content-Type': 'image/webp' } })
      }
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
