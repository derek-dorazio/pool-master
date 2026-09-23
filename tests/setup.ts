/** Global test setup — runs before all test suites. */

// POOLMASTER_ENVIRONMENT and a version source are required at bootstrap
// (core/config.ts) with no fallback, so the suite supplies them the same way
// tests/integration/helpers.ts supplies JWT_SECRET: set only if the environment
// has not already, so a real value from CI or a shell export still wins.
process.env.POOLMASTER_ENVIRONMENT ??= 'test';
process.env.RELEASE_VERSION ??= '0.0.0-test';
