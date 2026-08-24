import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/core/tests/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 10000,
  },
})
