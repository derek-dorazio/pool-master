/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '../..',
  testMatch: ['<rootDir>/tests/integration/**/*.integration.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tests/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@poolmaster/shared/(.*)$': '<rootDir>/packages/shared/$1',
  },
  testTimeout: 30_000,
  // Run serially — integration tests share a database
  maxWorkers: 1,
  // #296 — same provider as the unit and functional suites, so the merged report adds up
  // identical per-line statement maps instead of two incompatible ones.
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'packages/core-api/src/**/*.ts',
    'packages/shared/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!packages/shared/dist/**',
    '!packages/shared/generated/**',
    '!packages/shared/openapi-ts.config.ts',
    '!packages/shared/package.json',
    '!packages/shared/tsconfig.json',
  ],
};
