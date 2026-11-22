import { describe, it, expect } from 'vitest'
import { loadDictionary } from '../recognize'

describe('loadDictionary', () => {
  it('splits one character per line and drops a trailing blank line', () => {
    const contents = 'a\nb\nc\n'
    expect(loadDictionary(contents)).toEqual(['a', 'b', 'c'])
  })

  it('preserves a literal space character as its own dictionary entry', () => {
    const contents = 'a\n \nb\n'
    expect(loadDictionary(contents)).toEqual(['a', ' ', 'b'])
  })

  it('strips a trailing carriage return from CRLF line endings without losing a real trailing space', () => {
    // guards against git's core.autocrlf rewriting resources/eslav-dict.txt despite
    // the .gitattributes entry Task 0 adds — this file is read byte-by-byte as
    // meaningful characters, so a stray \r would silently corrupt every entry
    const contents = 'a\r\n \r\nb\r\n'
    expect(loadDictionary(contents)).toEqual(['a', ' ', 'b'])
  })
})
