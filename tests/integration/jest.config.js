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
  globalSetup: '<rootDir>/tests/support/version-info-global-setup.cjs',
  testTimeout: 30_000,
  // Run serially — integration tests share a database
  maxWorkers: 1,
  // #302 — no coverageProvider here: CI runs this suite without coverage. Only
  // run-backend-coverage.mjs collects it, with --coverageProvider=v8 so it merges with the FAPI
  // server's V8 coverage (#296).
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
