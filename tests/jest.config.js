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
    // it covers what no per-file floor does: routes, handlers, wiring, ingestion's adapters and
    // persistence, core-api's `core` and `adapters` folders and the rest of `packages/shared`.
    // Most of that is proven by the integration and functional suites, so the unit figure is low. Re-measured on 2026-11-09 (#1481) with every per-file
    // glob out of it, mappers now among them, Babel: 32.5 / 26.24 / 24.36 / 32.93. About 1 point under; raise it as
    // coverage grows, never lower it to pass.
    global: {
      statements: 31.5,
      branches: 25.25,
      functions: 23.5,
      lines: 32,
    },
    // A file matched by several globs must meet every one of them: a scoring file is held to both.
    ...scoringFloors(),
    ...logicFloors(),
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

/**
 * Per-file floors on the rest of the unit-testable logic (#1477): module services and module
 * logic, core-api's mappers (#1481), shared domain and shared DTOs, each file at 90% lines and
 * 80% branches. Left out, since a unit test is not what proves them: routes and handlers (#1482),
 * wiring, job-request declarations, repositories, barrels, and ingestion's provider adapters and
 * persistence, which are database and network calls the integration suite covers.
 */
function logicFloors() {
  const root = path.join(__dirname, '..');
  const modules = path.join(root, 'packages/core-api/src/modules');
  const logicFile = '!(routes|*-routes|handler|*-handler|wiring|*-job-requests|repository|*-repository|index).ts';
  const floor = { lines: 90, branches: 80 };
  return Object.fromEntries([
    path.join(modules, `!(ingestion)/**/${logicFile}`),
    path.join(modules, `ingestion/${logicFile}`),
    path.join(modules, `ingestion/!(adapters|persistence)/**/${logicFile}`),
    path.join(root, 'packages/core-api/src/mappers/!(index).ts'),
    path.join(root, 'packages/shared/domain/**/*.ts'),
    path.join(root, 'packages/shared/dto/**/*.ts'),
  ].map((glob) => [glob, floor]));
}
