/**
 * Jest config for API smoke tests.
 * These tests hit real running services — requires npm run dev:start first.
 */

import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/*.smoke.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
  moduleNameMapper: {
    '^@poolmaster/shared/(.*)$': '<rootDir>/../../packages/shared/$1',
  },
  setupFilesAfterEnv: ['./setup.ts'],
  testTimeout: 15_000,
};

export default config;
