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
};
