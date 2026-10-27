/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '../..',
  testMatch: ['<rootDir>/tests/integration/**/*.integration.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tests/tsconfig.json' }],
    // content-disposition 3 (under @fastify/static, which swagger-ui serves its page with) ships
    // ESM only, and Jest 29 cannot require ESM; Node can, so only these suites need it compiled
    // to CommonJS. Drop this, and the pattern below, with Jest 30.
    '/node_modules/content-disposition/.+\\.js$': [
      'ts-jest',
      { tsconfig: { allowJs: true, module: 'commonjs', target: 'es2022' } },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!content-disposition/)'],
  moduleNameMapper: {
    '^@poolmaster/shared/(.*)$': '<rootDir>/packages/shared/$1',
  },
  globalSetup: '<rootDir>/tests/support/version-info-global-setup.cjs',
  testTimeout: 30_000,
  // Run serially — integration tests share a database
  maxWorkers: 1,
  // #302 — no coverageProvider here: CI runs this suite without coverage. Only
  // run-backend-coverage.mjs collects it, with --coverageProvider=v8 so it merges with the FAPI
  // server's V8 coverage (#296).
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
};
