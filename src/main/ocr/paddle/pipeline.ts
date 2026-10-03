import fs from 'fs'
import path from 'path'
import { InferenceSession } from 'onnxruntime-node'
import { runDetection } from './detect'
import { runRecognition, loadDictionary } from './recognize'
import { runLayout } from './layout'
import { assembleBlocks } from './assemble'
import { blocksToLines } from '../blocks'
import { joinLines } from '../postprocess'
import { prepareImage } from './image'
import type { PreparedImage } from './image'
import type { RecognizedLine } from './assemble'
import type { TessBlock } from '../blocks'

export interface Sessions {
  det: InferenceSession
  rec: InferenceSession
  layout: InferenceSession
  dict: string[]
}

export interface PipelineResult {
  text: string
  confidence: number
}

// Severity 3 = errors only: the exported graphs log a warning per unused initializer.
const SESSION_OPTIONS = { logSeverityLevel: 3 } as const

export const loadSessions = async (modelsDir: string): Promise<Sessions> => {
  const [det, rec, layout] = await Promise.all([
    InferenceSession.create(path.join(modelsDir, 'det.onnx'), SESSION_OPTIONS),
    InferenceSession.create(path.join(modelsDir, 'rec.onnx'), SESSION_OPTIONS),
    InferenceSession.create(path.join(modelsDir, 'layout.onnx'), SESSION_OPTIONS)
  ])
  const dict = loadDictionary(fs.readFileSync(path.join(modelsDir, '..', 'eslav-dict.txt'), 'utf-8'))
  return { det, rec, layout, dict }
}

const recognizeLines = async (sessions: Sessions, image: PreparedImage): Promise<RecognizedLine[]> => {
  const boxes = await runDetection(sessions.det, image)
  const recognized: RecognizedLine[] = []
  for (const box of boxes) {
    const { text, confidence } = await runRecognition(sessions.rec, image, box, sessions.dict)
    if (text.trim().length > 0) recognized.push({ box, text, confidence })
  }
  return recognized
}

const recognizeBlocksFrom = async (sessions: Sessions, image: PreparedImage): Promise<{ blocks: TessBlock[]; lines: RecognizedLine[] }> => {
  const [lines, regions] = await Promise.all([recognizeLines(sessions, image), runLayout(sessions.layout, image)])
  return { blocks: assembleBlocks(lines, regions), lines }
}

export const recognizeBlocks = async (sessions: Sessions, imagePath: string): Promise<TessBlock[]> =>
  (await recognizeBlocksFrom(sessions, await prepareImage(imagePath))).blocks

export const processImage = async (sessions: Sessions, imagePath: string): Promise<PipelineResult> => {
  const { blocks, lines } = await recognizeBlocksFrom(sessions, await prepareImage(imagePath))
  const text = joinLines(blocksToLines(blocks))
  const confidence = lines.length === 0 ? 0 : lines.reduce((sum, r) => sum + r.confidence, 0) / lines.length
  return { text, confidence }
}
