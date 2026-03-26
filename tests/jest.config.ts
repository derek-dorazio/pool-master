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
  ],
};

export default config;
