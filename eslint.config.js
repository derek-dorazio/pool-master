import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import poolmaster from './eslint-rules/index.mjs';

/**
 * Selector sets are hoisted to module scope on purpose.
 *
 * ESLint flat config does NOT merge rule OPTIONS across config objects. A later
 * `{ files: [...], rules: { 'no-restricted-syntax': [...] } }` block supplies its
 * own options array, which REPLACES this one inside that scope rather than adding
 * to it -- SILENTLY DISABLING every selector below there, while `npm run lint`
 * stays green and nothing reports the loss.
 *
 * The precise rule, measured with `--print-config`, because the sloppy version of
 * it ("the last matching object always wins") is wrong and leads people to restate
 * options they did not need to:
 *
 *   later entry is a bare severity      -> earlier options are RETAINED
 *     'rule': 'error'                      => [2, {...inherited options}]
 *   later entry supplies an options array -> earlier options are DISCARDED
 *     'rule': ['error', {}]                => [2, {}]
 *
 * So severity-only overrides and additive plugin blocks are safe. Only a scoped
 * re-declaration WITH options is the trap. It is not hypothetical: the migration
 * that produced this plugin (#134) originally proposed five scanners as layered
 * `no-restricted-syntax` blocks, which caught 4 of 16 planted violations while
 * `npm run lint` stayed green. That measurement is why named rules exist below.
 *
 * Rule: any scoped re-declaration must spread these, e.g.
 *   'no-restricted-syntax': ['error', ...CAST_SELECTORS, ...YOUR_NEW_SELECTORS]
 */
const CAST_SELECTORS = [
  {
    // `x as unknown as T` parses as an outer TSAsExpression whose expression is
    // an inner TSAsExpression annotated `unknown`; this matches the inner node.
    // Deliberately NOT no-explicit-any + the no-unsafe-* family, which plan 135
    // proposed: all 20 findings this replaced were `as unknown as`, involving no
    // `any` at all, so that replacement would have matched none of them.
    selector: 'TSAsExpression > TSAsExpression[typeAnnotation.type="TSUnknownKeyword"]',
    message:
      'Do not bridge generated/domain contract gaps with "as unknown as"; fix the contract or mapper.',
  },
  {
    selector: 'TSAsExpression[typeAnnotation.type="TSAnyKeyword"]',
    message: 'Avoid "as any" in application code; use a real type, helper, or documented boundary.',
  },
];

/**
 * Repo conventions live here rather than in `scripts/check-*.mjs` wherever ESLint
 * can express them, so violations surface in the editor at write time instead of
 * at push time in CI. The migration was #134; the failure modes it hit are
 * codified in `rules/workflow-rules.md §2` *Retiring an enforcement script*.
 *
 * Every migrated rule was verified against the scanner it replaces by diffing
 * findings across the real tree. A rule that merely looks equivalent is not.
 *
 * Severity is `error` throughout: `npm run lint` runs with `--max-warnings 0`,
 * so a `warn` would fail CI anyway while reading as advisory. The backlogs these
 * rules would have inherited were cleared first rather than tolerated.
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
      // Regenerated from OpenAPI by `npm run api:refresh`. A finding here is not
      // fixable by hand and would block CI on generated output, so it is excluded
      // — matching the scanners, which never walked the generated tree.
      '**/generated/**',
      // Build/export helpers. Excluded by the scanners this config replaces.
      '**/scripts/**',
      // Codegen configuration, not shipped code, and in no tsconfig `include`.
      // Harmless while the parser was untyped; with `projectService` on, a file
      // outside the project graph is a hard parse error rather than a finding.
      // Surfaced when the lint glob widened to `packages/**` (#155) and this
      // config turned on type-aware parsing -- neither change breaks alone.
      '**/openapi-ts.config.ts',
      // Generated declaration output; never belonged in lint scope.
      '**/*.d.ts',
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',

      // Was 'warn'. Baseline is 0, so promoting it costs nothing and stops an
      // unused symbol from riding in behind --max-warnings 0 being relaxed later.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // Replaces scripts/check-unsafe-casts.mjs.
      //
      // Deliberately NOT '@typescript-eslint/no-explicit-any' plus the no-unsafe-*
      // family, which plan 135 proposed: all 20 findings the scanner reported were
      // `as unknown as`, which involves no `any` at all, so that replacement would
      // have matched none of them.
      //
      // `x as unknown as T` parses as an outer TSAsExpression whose expression is
      // an inner TSAsExpression annotated `unknown`; the first selector matches
      // that inner node. The second covers the `as any` half the scanner also
      // checked. Verified a strict superset of the scanner's findings.
      'no-restricted-syntax': ['error', ...CAST_SELECTORS],
    },
  },
  {
    // The scanner exempted test files, and that exemption is kept: a cast in a
    // test is usually building a deliberate partial fixture, which is a different
    // act from bridging a contract gap in production code.
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/test/**/*.{ts,tsx}', '**/tests/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // Replaces scripts/check-no-non-sdk-fetch.mjs. Frontend HTTP goes through the
    // generated SDK; these are the two escape hatches the scanner also allowed.
    files: ['clients/poolmaster/src/**/*.{ts,tsx}'],
    ignores: [
      'clients/poolmaster/src/lib/api.ts',
      'clients/poolmaster/src/lib/logger/network-sink.ts',
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      '**/test/**',
      '**/tests/**',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Non-SDK HTTP call — use generated SDK operations from @/lib/api.' },
        { name: 'XMLHttpRequest', message: 'Non-SDK HTTP call — use generated SDK operations from @/lib/api.' },
      ],
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'axios', message: 'Non-SDK HTTP call — use generated SDK operations from @/lib/api.' }] },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // Local rules — see eslint-rules/index.mjs for why these are named rules
  // rather than more `no-restricted-syntax` selectors.
  //
  // Each block carries its own `files`/`ignores`, transcribed from the exclusion
  // list of the scanner it replaces. That is the whole reason for the plugin:
  // distinct rule ids compose, where a second `no-restricted-syntax` block would
  // have replaced the first.
  // ---------------------------------------------------------------------------
  {
    files: ['clients/poolmaster/src/**/*.{ts,tsx}'],
    // The factory itself is where the key arrays are supposed to live.
    ignores: ['clients/poolmaster/src/lib/query-keys.ts'],
    plugins: { poolmaster },
    rules: { 'poolmaster/no-inline-query-keys': 'error' },
  },
  {
    // Tests included deliberately: the scanner walked them, and a mocked API
    // boundary in a test is the only place this pattern ever appears.
    files: ['clients/poolmaster/src/**/*.{ts,tsx}'],
    plugins: { poolmaster },
    rules: { 'poolmaster/no-mocked-api': 'error' },
  },
  {
    // Feature code only. The shared primitives are where a bare control is
    // supposed to live, and a test rendering a raw <button> is building a
    // fixture rather than shipping UI.
    files: ['clients/poolmaster/src/features/**/*.tsx'],
    ignores: [
      'clients/poolmaster/src/features/shared/ui/**',
      '**/*.test.tsx',
      '**/*.spec.tsx',
    ],
    plugins: { poolmaster },
    rules: { 'poolmaster/no-bare-ui-controls': 'error' },
  },
  {
    // lib/errors.ts is the canonical definition; tests may build local stand-ins.
    files: ['clients/poolmaster/src/**/*.{ts,tsx}'],
    ignores: [
      'clients/poolmaster/src/lib/errors.ts',
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
    ],
    plugins: { poolmaster },
    rules: { 'poolmaster/no-duplicate-extract-error-message': 'error' },
  },
  {
    // .tsx only -- an inline style prop is JSX. Tests excluded, matching the
    // scanner.
    files: ['clients/poolmaster/src/**/*.tsx'],
    ignores: ['**/*.test.tsx', '**/*.spec.tsx'],
    plugins: { poolmaster },
    rules: { 'poolmaster/no-inline-theme-styles': 'error' },
  },
  {
    // Matches the scanner: all of clients/poolmaster/src, tests excluded, because
    // a test may legitimately build a local stand-in named after the real shape.
    files: ['clients/poolmaster/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    plugins: { poolmaster },
    rules: { 'poolmaster/no-parallel-api-types': 'error' },
  },
  {
    // Test files across every workspace, matching the scanner's walk roots
    // (tests/, packages/, clients/poolmaster/src/). The rule also fires on the
    // file path itself, so a parked `*.skip.test.ts` is caught by being linted
    // at all -- which is why the glob covers those names too.
    files: [
      'tests/**/*.{ts,tsx}',
      'packages/**/*.{test,spec}.{ts,tsx}',
      'packages/**/__tests__/**/*.{ts,tsx}',
      'clients/poolmaster/src/**/*.{test,spec}.{ts,tsx}',
      '**/*.skip.{test,spec}.{ts,tsx}',
      '**/skipped/**/*.{ts,tsx}',
    ],
    plugins: { poolmaster },
    rules: { 'poolmaster/no-disabled-tests': 'error' },
  },
  {
    // Hand-written types that mirror a Prisma row. The ignores are integration
    // boundaries where the value genuinely is an unvalidated string -- each one
    // was inspected, not guessed:
    //   bulk-service.ts        a parsed CSV row, before validation
    //   participants/handler.ts an unvalidated HTTP request body
    //   user-account-summary   a display label ("Root admin"), not an enum value
    files: ['packages/core-api/src/**/*.ts', 'packages/shared/domain/**/*.ts',
            'clients/poolmaster/src/**/*.{ts,tsx}'],
    ignores: [
      'packages/core-api/src/modules/leagues/bulk-service.ts',
      'packages/core-api/src/modules/participants/handler.ts',
      // HTTP request bodies — a string until the route schema validates it.
      'packages/core-api/src/modules/leagues/handler.ts',
      'packages/core-api/src/modules/squads/handler.ts',
      'clients/poolmaster/src/features/account/user-account-summary.tsx',
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
    ],
    plugins: { poolmaster },
    rules: { 'poolmaster/no-widened-enum-fields': 'error' },
  },
  {
    // Backend source only, matching the scanner's SCAN_ROOT. Deployment identity
    // must come from the bootstrap readers in core/config.ts, which throw.
    files: ['packages/core-api/src/**/*.ts'],
    plugins: { poolmaster },
    rules: {
      'poolmaster/no-env-fallbacks': ['error', {
        // LOG_LEVEL is a tunable, not an identity: a wrong verbosity is a nuisance,
        // not a deployment reporting itself as something it is not. Everything
        // else that reads an env name gets a reader that throws.
        allow: ['LOG_LEVEL'],
      }],
    },
  },
);
