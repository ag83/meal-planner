import fs from 'fs/promises'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { electronModule, makeTempDir, paths } from '../../__tests__/electronMock'
import { closeDb, getDb } from '../../db/connection'
import { vaultManager } from '../../vault/manager'
import { registerThumbProtocol } from '../thumb'

vi.mock('electron', async () => (await import('../../__tests__/electronMock')).electronModule)

let root: string
let request: (url: string) => Promise<Response>

beforeAll(async () => {
  registerThumbProtocol()
  const handler = electronModule.protocol.handle.mock.calls[0][1] as (r: {
    url: string
  }) => Promise<Response>
  request = (url) => handler({ url })
  root = await makeTempDir()
  paths.userData = root
})

afterAll(async () => {
  closeDb()
  await fs.rm(root, { recursive: true, force: true })
})

describe('recipe-thumb protocol', () => {
  it('rejects malformed ids', async () => {
    expect((await request('recipe-thumb://thumb/a%2Fb')).status).toBe(400)
  })

  it('returns 404 without a vault', async () => {
    expect((await request('recipe-thumb://thumb/abc')).status).toBe(404)
  })

  describe('with a vault', () => {
    beforeAll(async () => {
      const vaultPath = path.join(root, 'vault')
      await vaultManager.open(vaultPath)
      const insert = getDb().prepare(
        'INSERT INTO recipes (id,ext,sha256,width,height,created_at,updated_at) VALUES (?,?,?,1,1,1,1)'
      )
      insert.run('jay', 'jpg', 'jay')
      insert.run('pee', 'png', 'pee')
      insert.run('nofile', 'png', 'nofile')
      await fs.writeFile(path.join(vaultPath, 'pictures', 'jay.jpg'), 'J')
      await fs.writeFile(path.join(vaultPath, 'pictures', 'pee.png'), 'P')
      await fs.writeFile(path.join(vaultPath, 'thumbs', 'jay.webp'), 'T')
    })

    it.each([
      ['thumb/jay', 'image/webp', 'T'],
      ['full/jay', 'image/jpeg', 'J'],
      ['full/pee', 'image/png', 'P']
    ])('serves %s', async (route, mime, body) => {
      const response = await request(`recipe-thumb://${route}`)
      expect(response.headers.get('Content-Type')).toBe(mime)
      await expect(response.text()).resolves.toBe(body)
    })

    it.each([['full/unknown'], ['full/nofile'], ['thumb/unknown']])(
      'returns 404 for %s',
      async (route) => {
        expect((await request(`recipe-thumb://${route}`)).status).toBe(404)
      }
    )
  })
})
