/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '..',
  testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@poolmaster/shared/(.*)$': '<rootDir>/packages/shared/$1',
    '^@poolmaster/mock-contest-feed-provider/generated/hey-api/types$':
      '<rootDir>/packages/mock-contest-feed-provider/generated/hey-api/types.gen.ts',
  },
  globalSetup: '<rootDir>/tests/support/version-info-global-setup.cjs',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  coverageDirectory: '<rootDir>/coverage',
  // #302 — no coverageProvider here: CI's gating run uses Jest's default (Babel), which is the
  // method the coverageThreshold below was set against and costs ~7s rather than V8's ~37s.
  // run-backend-coverage.mjs passes --coverageProvider=v8 for the merged report (#296).
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
  coverageThreshold: {
    global: {
      statements: 24,
      branches: 14.2,
      functions: 21.15,
      lines: 24.53,
    },
  },
};
