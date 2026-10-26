import { defineConfig } from 'vitest/config'

/** SQLite integration tests (indexer, migrations, search). Run via `npm run test:db`. */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/db/**/*.test.ts'],
    // Real SQLite files on disk: on Windows CI runners every commit's fsync is slow (the
    // v8 migration test took 9 s there), so the 5 s default flakes. Files run one at a
    // time so they do not compete for the disk.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})
