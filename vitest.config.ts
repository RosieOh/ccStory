import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // SQLite integration tests run separately: `npm run test:db`.
    exclude: ['tests/db/**', 'node_modules/**'],
  },
})
