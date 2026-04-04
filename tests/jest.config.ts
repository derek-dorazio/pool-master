import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@poolmaster/shared/(.*)$': '<rootDir>/../packages/shared/$1',
  },
  setupFilesAfterEnv: ['./setup.ts'],
  coverageDirectory: '../coverage',
  collectCoverageFrom: [
    '../packages/*/src/**/*.ts',
    '../packages/shared/**/*.ts',
    '!**/*.d.ts',
    '!**/index.ts',
    '!../packages/shared/dist/**',
    '!../packages/shared/generated/**',
    '!../packages/shared/openapi-ts.config.ts',
    '!../packages/shared/package.json',
    '!../packages/shared/tsconfig.json',
  ],
  coverageThreshold: {
    global: {
      statements: 25.45,
      branches: 15.68,
      functions: 22.93,
      lines: 25.81,
    },
  },
};

export default config;
