/** Global test setup — runs before all test suites. */

// POOLMASTER_ENVIRONMENT is required at bootstrap (core/config.ts) with no
// fallback, so the suite supplies it the same way
// tests/integration/helpers.ts supplies JWT_SECRET: set only if the environment
// has not already, so a real value from CI or a shell export still wins. The
// version comes from version-info.json, which the jest globalSetup writes (#180).
process.env.POOLMASTER_ENVIRONMENT ??= 'test';
// The logger no longer branches on NODE_ENV (#184); the suite quietens itself instead.
process.env.LOG_LEVEL ??= 'warn';
