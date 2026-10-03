import fs from 'fs'
import path from 'path'
import { InferenceSession } from 'onnxruntime-node'
import { runDetection } from './detect'
import { runRecognition, loadDictionary } from './recognize'
import { runLayout } from './layout'
import { assembleBlocks } from './assemble'
import { blocksToLines } from '../blocks'
import { joinLines } from '../postprocess'
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

export const recognizeLines = async (sessions: Sessions, imagePath: string): Promise<RecognizedLine[]> => {
  const boxes = await runDetection(sessions.det, imagePath)
  const recognized: RecognizedLine[] = []
  for (const box of boxes) {
    const { text, confidence } = await runRecognition(sessions.rec, imagePath, box, sessions.dict)
    if (text.trim().length > 0) recognized.push({ box, text, confidence })
  }
  return recognized
}

export const recognizeBlocks = async (sessions: Sessions, imagePath: string): Promise<TessBlock[]> => {
  const [recognized, regions] = await Promise.all([
    recognizeLines(sessions, imagePath),
    runLayout(sessions.layout, imagePath)
  ])
  return assembleBlocks(recognized, regions)
}

export const processImage = async (sessions: Sessions, imagePath: string): Promise<PipelineResult> => {
  const [recognized, regions] = await Promise.all([
    recognizeLines(sessions, imagePath),
    runLayout(sessions.layout, imagePath)
  ])

  const text = joinLines(blocksToLines(assembleBlocks(recognized, regions)))
  const confidence =
    recognized.length === 0 ? 0 : recognized.reduce((sum, r) => sum + r.confidence, 0) / recognized.length

  return { text, confidence }
}
