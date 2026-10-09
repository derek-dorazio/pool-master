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
      // About 3 points under the lower of the two measurements of this suite (#298): Babel, here,
      // 71.3 / 63.75 / 65.45 / 71.07; V8, in the merged report, 67.95 / 83.04 / 79.03 / 67.95.
      statements: 65,
      branches: 60.5,
      functions: 62,
      lines: 65,
    },
  },
};
