import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import tanstackQuery from '@tanstack/eslint-plugin-query';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import jest from 'eslint-plugin-jest';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import vitest from 'eslint-plugin-vitest';
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

const WEBAPP_FILES = ['clients/poolmaster/src/**/*.{ts,tsx}'];

/**
 * Several plugin presets ship some rules at `warn`. Under `--max-warnings 0` a
 * warning fails CI anyway, so `warn` only misleads; this pins every rule a preset
 * enables to `error`, keeping its options and leaving its `off` rules off.
 */
function asErrors(rules) {
  return Object.fromEntries(
    Object.entries(rules).map(([name, entry]) => {
      const [severity, ...options] = Array.isArray(entry) ? entry : [entry];
      const off = severity === 'off' || severity === 0;
      return [name, off ? entry : ['error', ...options]];
    }),
  );
}

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

      // #162 — a type-only import that is not marked `import type` is emitted as a real
      // import by the transpiler. Under `isolatedModules` that is how a build ends up with a
      // runtime dependency on a module it only needed types from, and how a circular import
      // appears between two modules that only reference each other's types.
      //
      // `fixStyle: 'inline-type-imports'` keeps a mixed import in one statement
      // (`import { a, type B }`) rather than splitting it into two, which is the style already
      // used across the codebase. `import()` type annotations are forbidden by default and stay
      // so: there are two, both in files that can say it as a normal import.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

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
    rules: {
      'poolmaster/no-widened-enum-fields': 'error',
      'poolmaster/no-bare-enum-literals': 'error',
    },
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

  // ---------------------------------------------------------------------------
  // Third-party plugins (#156). Each was measured at zero findings against the
  // tree, with a planted positive control proving the rule actually ran, before
  // being adopted -- a zero without a control is indistinguishable from a rule
  // that matched no files.
  //
  // Appended last so nothing here can sit between the shared-rules block and the
  // test-file override above. None of these plugins declares any rule name that
  // block declares, so they cannot replace its options in either order.
  //
  // Every block carries an explicit `files` key: without one, a block matches only
  // ESLint's default js/mjs/cjs extensions and the rules silently lint nothing.
  // ---------------------------------------------------------------------------
  {
    files: WEBAPP_FILES,
    plugins: { 'react-hooks': reactHooks },
    // `exhaustive-deps` is deliberately not adopted; it conflicts with written
    // repo rules and is tracked separately (#157).
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  },
  {
    files: WEBAPP_FILES,
    plugins: { react },
    settings: { react: { version: 'detect' } },
    rules: asErrors({
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
    }),
  },
  {
    // Tests included: the one `aria-role` finding the option below answers was in
    // a test file, and an inaccessible fixture is still worth knowing about.
    files: ['clients/poolmaster/src/**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: {
      ...asErrors(jsxA11y.flatConfigs.recommended.rules),
      // The plugin cannot see through the shared primitives: in
      // `<label><span>Text</span><Input /></label>` it does not know `Input`
      // renders an <input>. Naming the primitives is the configuration answer.
      'jsx-a11y/label-has-associated-control': ['error', {
        controlComponents: ['Input', 'Textarea', 'Checkbox', 'Select', 'FileInput'],
      }],
      // The repo uses `role` as a domain prop (a league-membership role such as
      // "Member") on its own components. Those are not ARIA roles; DOM elements
      // are still checked.
      'jsx-a11y/aria-role': ['error', { ignoreNonDOM: true }],
    },
  },
  {
    files: ['packages/**/*.ts', ...WEBAPP_FILES],
    plugins: { 'import-x': importX },
    settings: {
      // `flatConfigs.typescript` is what puts .ts/.tsx into `import-x/extensions`.
      // Without it the module graph is empty for every TS file and `no-cycle`
      // reports zero forever, however many cycles exist.
      ...importX.flatConfigs.typescript.settings,
      // Takes precedence over the preset's legacy `import-x/resolver`. Naming the
      // projects is what resolves the webapp's `@/` alias; each file resolves
      // against the tsconfig that includes it.
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          project: ['clients/poolmaster/tsconfig.json', 'packages/*/tsconfig.json'],
          noWarnOnMultipleProjects: true,
        }),
      ],
    },
    rules: {
      'import-x/no-cycle': 'error',
      'import-x/no-unresolved': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': 'error',
    },
  },
  {
    files: WEBAPP_FILES,
    plugins: { '@tanstack/query': tanstackQuery },
    // Recommended minus `exhaustive-deps`, which cannot see inside the query-key
    // factories `react-ui-rules.md` §4 mandates and so reports ids that are
    // already in the key. Listed rather than spread so a plugin upgrade cannot
    // add a rule here unreviewed.
    rules: {
      '@tanstack/query/no-rest-destructuring': 'error',
      '@tanstack/query/stable-query-client': 'error',
      '@tanstack/query/no-unstable-deps': 'error',
      '@tanstack/query/infinite-query-property-order': 'error',
      '@tanstack/query/no-void-query-fn': 'error',
      '@tanstack/query/mutation-property-order': 'error',
    },
  },
  {
    // Test-scoped blocks sit after the test-file override above.
    //
    // `no-disabled-tests` is deliberately not adopted from either test plugin:
    // `poolmaster/no-disabled-tests` already reports every form they do (and
    // `todo`, `fails`, and parked files besides), so a second rule would report
    // each violation twice.
    files: ['clients/poolmaster/src/**/*.{test,spec}.{ts,tsx}'],
    plugins: { vitest },
    rules: {
      ...asErrors(vitest.configs.recommended.rules),
      'vitest/no-focused-tests': 'error',
      'vitest/no-commented-out-tests': 'error',
    },
  },
  {
    // The Jest suites live under tests/, which `npm run lint` does not pass to
    // ESLint today (see eslint.tests.config.mjs for why). These rules are in
    // place for when it does; until then they reach no file in that run.
    files: ['tests/**/*.{ts,tsx}'],
    plugins: { jest },
    // The two rules below do not read it, but any version-aware jest rule added
    // later would otherwise detect Jest from the cwd and throw "Unable to detect
    // Jest version" rather than report anything.
    settings: { jest: { version: 29 } },
    rules: {
      'jest/no-focused-tests': 'error',
      'jest/no-commented-out-tests': 'error',
    },
  },
);
