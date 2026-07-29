import fs from 'fs/promises'
import crypto from 'crypto'

export const hashFile = async (filePath: string): Promise<string> => {
  const buf = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(buf).digest('hex')
}
