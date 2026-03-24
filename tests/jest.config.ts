import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@poolmaster/shared/(.*)$': '<rootDir>/../packages/shared/$1',
  },
  setupFilesAfterSetup: ['./setup.ts'],
  coverageDirectory: '../coverage',
  collectCoverageFrom: [
    '../packages/*/src/**/*.ts',
    '../packages/shared/**/*.ts',
    '!**/*.d.ts',
    '!**/index.ts',
  ],
};

export default config;
