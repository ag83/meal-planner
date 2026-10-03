import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { blocksToLines } from '../blocks'
import { joinLines } from '../postprocess'
import type { TessBlock } from '../blocks'

const FIXTURES = path.join(process.cwd(), 'src/main/ocr/__tests__/fixtures')

const load = (name: string): TessBlock[] =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.blocks.json`), 'utf-8')) as TessBlock[]

const textOf = (name: string): string => joinLines(blocksToLines(load(name)))

describe('three-column page', () => {
  it('reads the left column as one contiguous passage', () => {
    expect(textOf('beef-three-column')).toContain(
      'Готовить 5 минут, помешивая. После чего влить 1 стакан кипятка или бульона и тушить до готовности'
    )
  })

  it('does not glue the next column onto the left column', () => {
    expect(textOf('beef-three-column')).not.toContain('После чего влить соку')
  })

  it('reads the middle and right columns as their own passages', () => {
    const text = textOf('beef-three-column')
    expect(text).toContain('соку измельчить в блендере')
    expect(text).toContain('Тушить все вместе 15 минут')
  })

  it('rejoins words hyphenated across line breaks', () => {
    const text = textOf('beef-three-column')
    for (const word of ['кусочками', 'полукольцами', 'бульона', 'блендере', 'вместе']) {
      expect(text).toContain(word)
    }
    expect(text).not.toContain('бульо-')
    expect(text).not.toContain('блен-')
  })

  it('keeps the title together, in reading order, ahead of the ingredients', () => {
    // The stylised title font comes out as Говядина B coyce ИЗ лука-порея: the
    // recognizer reads «в соусе из» as Latin look-alikes. Order and grouping are
    // what this test guards.
    expect(textOf('beef-three-column')).toMatch(/^Говядина .*лука-порея\n\n500 г мякоти/)
  })

  it('excludes the photograph region', () => {
    // Tesseract returns it as one whitespace word at confidence 95.
    expect(textOf('beef-three-column')).not.toMatch(/\n\s+\n/)
  })
})

describe('two-column page', () => {
  it('rejoins words hyphenated across line breaks', () => {
    const text = textOf('pork-two-column')
    for (const word of ['консервированных', 'обжарить', 'полукольцами', 'разрезать']) {
      expect(text).toContain(word)
    }
  })

  it('reads the ingredient sentence contiguously', () => {
    expect(textOf('pork-two-column')).toContain(
      '300 г свинины, луковица, 3 зубчика чеснока'
    )
  })
})
