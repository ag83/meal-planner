import path from 'path'
import { pathToFileURL } from 'url'
import { net, protocol } from 'electron'
import { vaultManager } from '../vault/manager'

// recipe-thumb://<id>  →  <vault>/thumbs/<id>.webp
export function registerThumbProtocol(): void {
  protocol.handle('recipe-thumb', async (request) => {
    const id = new URL(request.url).hostname

    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
      return new Response('Bad request', { status: 400 })
    }

    const vault = vaultManager.getCurrent()
    if (!vault) return new Response('Not found', { status: 404 })

    const thumbPath = path.join(vault.path, 'thumbs', `${id}.webp`)
    return net.fetch(pathToFileURL(thumbPath).href)
  })
}
