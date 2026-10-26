import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // DB integration tests need the native better-sqlite3 build: `npm run test:db`.
    exclude: ['tests/db/**', 'node_modules/**'],
    poolOptions: { threads: { singleThread: true } },
  },
})
