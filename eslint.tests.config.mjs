/**
 * A second, deliberately tiny flat config that runs ONE rule over `tests/`.
 *
 * Why this exists rather than adding `tests/**` to the main `npm run lint` glob:
 * the scanner this replaced (`scripts/check-test-disable-discipline.mjs`) walked
 * `tests/`, `packages/`, and `clients/poolmaster/src/`. The main lint command only
 * covers the latter two, so migrating the gate into `eslint.config.js` alone would
 * have silently dropped enforcement over the largest test tree in the repo -- the
 * gate would still be listed, still pass, and check nothing.
 *
 * Adding `tests/**` to the main run instead surfaces 2773 pre-existing errors from
 * `recommendedTypeChecked` (measured 2026-09-23, mostly `no-unsafe-*` and
 * `await-thenable` in older suites). Clearing that backlog, or exempting `tests/`
 * from type-aware linting, is a policy call worth making on purpose -- not a side
 * effect of migrating one gate. Until then this config keeps the gate's coverage
 * exactly as wide as the scanner's was, and nothing wider.
 *
 * No parser services, no type information: the rule is purely syntactic, so this
 * runs in well under a second.
 */
import tsParser from '@typescript-eslint/parser';
import poolmaster from './eslint-rules/index.mjs';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    // The parser is needed to read TypeScript syntax at all. `project` is
    // deliberately unset -- no type information, which is what keeps this fast
    // and keeps the type-aware backlog out of scope.
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { poolmaster },
    rules: { 'poolmaster/no-disabled-tests': 'error' },
  },
];
