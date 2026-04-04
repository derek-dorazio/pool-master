import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['unit/**/*.test.ts'],
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
      statements: 24,
      branches: 14.2,
      functions: 21.15,
      lines: 24.53,
    },
  },
};

export default config;
