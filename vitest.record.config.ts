import { defineConfig } from 'vitest/config'

// Separate from vitest.config.ts so `npm test` never downloads language data or
// pays several seconds per image. Run via `npm run ocr:record`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.record.ts'],
    testTimeout: 300000
  }
})
