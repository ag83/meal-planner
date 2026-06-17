import fs from 'fs/promises'
import crypto from 'crypto'

export async function hashFile(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(buf).digest('hex')
}
