import crypto from 'crypto'
import fs from 'fs/promises'

export const hashFile = async (filePath: string): Promise<string> => {
  const buf = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(buf).digest('hex')
}
