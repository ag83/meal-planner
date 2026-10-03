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

export const processImage = async (sessions: Sessions, imagePath: string): Promise<PipelineResult> => {
  const [boxes, regions] = await Promise.all([
    runDetection(sessions.det, imagePath),
    runLayout(sessions.layout, imagePath)
  ])

  const recognized: RecognizedLine[] = []
  for (const box of boxes) {
    const { text, confidence } = await runRecognition(sessions.rec, imagePath, box, sessions.dict)
    if (text.trim().length > 0) recognized.push({ box, text, confidence })
  }

  const text = joinLines(blocksToLines(assembleBlocks(recognized, regions)))
  const confidence =
    recognized.length === 0 ? 0 : recognized.reduce((sum, r) => sum + r.confidence, 0) / recognized.length

  return { text, confidence }
}
