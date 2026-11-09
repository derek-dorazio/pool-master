const path = require('node:path');

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
    // Files a glob below matches are left out of this total (Jest checks them on their own), so
    // it covers what no per-file floor does: routes, repositories, mappers, wiring. Re-measured on
    // 2026-11-09 (#1477) with the scoring files out of it, Babel: 72.72 / 68.38 / 66.80 / 73.19.
    // About 1 point under; raise it as coverage grows, never lower it to pass.
    global: {
      statements: 71.5,
      branches: 67.5,
      functions: 66,
      lines: 72,
    },
    ...scoringFloors(),
  },
};

/**
 * Per-file floors (#1477, rules/testing-rules.md §1 *Coverage Floors*): each file a glob matches
 * must meet the floor on its own. Absolute, since Jest resolves a threshold glob against the
 * working directory. Scoring, calculators, standings and settlement decide who wins: every line
 * is covered, and every branch a test can reach.
 */
function scoringFloors() {
  const modules = path.join(__dirname, '..', 'packages/core-api/src/modules');
  const floor = { statements: 100, branches: 96, functions: 100, lines: 100 };
  return Object.fromEntries([
    'scoring-families/**/*.ts',
    'contests/*-standings.ts',
    'contests/final-standings.ts',
    'contests/contest-leaderboard-calculator.ts',
    'contests/contest-settlement-service.ts',
    'events/bracket-reseed.ts',
    'notifications/live-standings.ts',
  ].map((glob) => [path.join(modules, glob), floor]));
}
