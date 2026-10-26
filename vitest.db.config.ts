import { defineConfig } from 'vitest/config'

/** SQLite integration tests (indexer, migrations, search). Run via `npm run test:db`. */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/db/**/*.test.ts'],
    // One worker process: the native module must load under the same runtime it was built for.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})
