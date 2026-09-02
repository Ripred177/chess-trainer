import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@shared': `${root}src/shared`,
      '@': `${root}src/renderer/src`
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The inference tests load a 21MB model; the default 5s is not enough on a
    // cold start.
    testTimeout: 30_000
  }
})
