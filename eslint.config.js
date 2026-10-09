import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import tanstackQuery from '@tanstack/eslint-plugin-query';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import jest from 'eslint-plugin-jest';
import jestDom from 'eslint-plugin-jest-dom';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import testingLibrary from 'eslint-plugin-testing-library';
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

      // #345 Phase 0 (from #160's survey of all 61 type-aware rules) — the eleven
      // type-aware rules that are outside `recommendedTypeChecked` and measured at
      // 0 findings over this lint scope at DEFAULT options.
      //
      // #160 named twenty-one such rules; ten of them turned out to be inside
      // `recommendedTypeChecked`, which this config already spreads, so they have
      // been enforced since #308 and are not restated here. Verified with
      // `--print-config`, not inferred: `await-thenable`, `no-array-delete`,
      // `no-duplicate-type-constituents`, `no-for-in-array`, `no-implied-eval`,
      // `no-unsafe-enum-comparison`, `no-unsafe-unary-minus`,
      // `prefer-promise-reject-errors`, `restrict-plus-operands` and
      // `no-misused-promises` are already on.
      //
      // Default options are load-bearing on two of these. Do NOT inherit
      // `strictTypeChecked`'s options wholesale if that preset is ever adopted
      // (#345 Phase 4): #160 measured `restrict-template-expressions` at 2 findings
      // on defaults and 151 under strict's options. These eleven are listed
      // individually rather than spread from a preset so a typescript-eslint
      // upgrade cannot add a rule here unreviewed.
      '@typescript-eslint/no-mixed-enums': 'error',
      '@typescript-eslint/no-unnecessary-qualifier': 'error',
      '@typescript-eslint/no-unnecessary-template-expression': 'error',
      '@typescript-eslint/no-useless-default-assignment': 'error',
      '@typescript-eslint/prefer-find': 'error',
      '@typescript-eslint/prefer-includes': 'error',
      '@typescript-eslint/prefer-reduce-type-parameter': 'error',
      '@typescript-eslint/prefer-return-this-type': 'error',
      '@typescript-eslint/prefer-string-starts-ends-with': 'error',
      '@typescript-eslint/related-getter-setter-pairs': 'error',
      '@typescript-eslint/require-array-sort-compare': 'error',

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
    // #524 — build-tool configs. Each sits outside its package's `tsconfig.json` on
    // purpose (they run in Node, and the codegen configs must stay out of `dist`), so
    // `projectService`, which only finds the nearest `tsconfig.json`, cannot place
    // them and reports a hard parse error. Naming the programs that include them is
    // what lets the type-aware rules reach them at all.
    files: [
      'clients/poolmaster/*.config.ts',
      'packages/*/openapi-ts.config.ts',
    ],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: [
          'clients/poolmaster/tsconfig.node.json',
          'clients/poolmaster/tsconfig.e2e.json',
          'packages/shared/tsconfig.node.json',
          'packages/mock-contest-feed-provider/tsconfig.node.json',
        ],
      },
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
  {
    // #149 — `ZodTypeAny` is `ZodType<any, any, any>`. The `any`s sit inside a named import,
    // so no-explicit-any cannot see them; this is the only rule that does.
    files: ['packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{
            name: 'zod',
            importNames: ['ZodTypeAny'],
            message: 'ZodTypeAny is ZodType<any, any, any>. Use ZodType<unknown>, or a generic bounded by it.',
          }],
        },
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
    // Feature code only, tests included, minus the shared primitives -- the scanner's
    // walk root and exclusion list. The primitives are where raw colour classes are
    // allowed to live.
    files: ['clients/poolmaster/src/features/**/*.{ts,tsx}'],
    ignores: ['clients/poolmaster/src/features/shared/ui/**'],
    plugins: { poolmaster },
    rules: { 'poolmaster/no-raw-theme-colors': 'error' },
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
    // Backend source: a gate that sends its rejection without awaiting lets Fastify run the
    // handler behind it (#193, #458).
    files: ['packages/core-api/src/**/*.ts'],
    plugins: { poolmaster },
    rules: { 'poolmaster/no-unawaited-send-error': 'error' },
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
  {
    // Which environment this is comes from POOLMASTER_ENVIRONMENT via readAppEnv(); NODE_ENV
    // is the Node ecosystem's and is "production" in every deployment (#184). No allowlist.
    files: ['packages/*/src/**/*.ts'],
    plugins: { poolmaster },
    rules: { 'poolmaster/no-node-env-reads': 'error' },
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
    // `exhaustive-deps` is on; deliberate exceptions cite rules/react-ui-rules.md §5 inline.
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // #345 Phase 0 (from #167). A module that exports both a React component and a
    // non-component value breaks Fast Refresh: editing the component triggers a
    // full page reload instead of a hot update, silently losing component state.
    // Nothing else in the toolchain reports that.
    //
    // 14 findings across 10 files on this branch (#167 measured 12 across 8 on
    // 2026-09-23). Every one was resolved by moving the non-component export to
    // its own module -- extraction, not suppression, per #167's acceptance.
    //
    // `allowConstantExport` is not set because it would buy nothing: measured at
    // 14 findings with the option on, the same 14 as without it. None of these is
    // a bare `export const FOO = 'literal'` -- they are hooks, helpers, variant
    // maps and two HOCs. The option is documented as the cheap escape hatch for
    // this rule, so the measurement is recorded here to save the next reader
    // reaching for it.
    files: WEBAPP_FILES,
    plugins: { 'react-refresh': reactRefresh },
    rules: { 'react-refresh/only-export-components': 'error' },
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
      // #159 — a barrel that `export *`s one module and explicitly re-exports the
      // same name from another hands consumers the type of one definition and the
      // value of the other. tsc does not report that; this does.
      'import-x/export': 'error',

      // -----------------------------------------------------------------------
      // #345 Phase 1 (from #168) — the rest of `flatConfigs.recommended`.
      //
      // Listed rule by rule rather than spread from the preset, because the preset
      // does not survive contact with this codebase: of its eight rules, five are
      // at zero and three are pure CommonJS-interop noise. Adopting it wholesale
      // would add 21 permanent findings that are all correct code, and the usual
      // answer to that -- a per-site disable comment -- would spread 21 of them
      // through files that have nothing wrong with them.
      //
      // So each rule's disposition is recorded HERE, where the next reader who
      // wonders why the preset is not simply spread will actually look.
      // -----------------------------------------------------------------------

      // ADOPTED at zero. Measured on this branch, not inherited from #168.
      'import-x/namespace': 'error',
      'import-x/no-named-as-default': 'error',

      // ADOPTED with fixes: 16 findings across 8 files, all `import type` + value
      // import from the same module, merged into one statement each.
      //
      // Pairs with `consistent-type-imports` above and must keep agreeing with it:
      // that rule wants type imports marked, this one wants them merged with the
      // value import from the same module. `fixStyle: 'inline-type-imports'` is
      // what makes both satisfiable at once (`import { a, type B } from 'm'`); the
      // default separate-import style would have the two rules undo each other.
      'import-x/no-duplicates': 'error',

      // OFF -- the two CommonJS-interop rules. `tsconfig.base.json` sets
      // `esModuleInterop: true`, which makes `import X from 'cjs-module'` correct
      // and idiomatic; these rules predate that being the norm and report it as
      // suspicious. Disabled explicitly, with the count each one would contribute,
      // rather than left on and suppressed per site.

      // 8 findings: `import bcrypt from 'bcryptjs'`, `import jwt from
      // 'jsonwebtoken'`, `import ReactDOM from 'react-dom/client'` and similar.
      // A CJS module has no ESM default export to find; `esModuleInterop`
      // synthesises one, which is the whole point of the flag.
      'import-x/default': 'off',

      // 12 findings, every one of the form "`bcrypt` also has a named export
      // `hash`". That is true and intended: the namespace-as-default import is
      // how these libraries are meant to be consumed under `esModuleInterop`.
      'import-x/no-named-as-default-member': 'off',

      // ADOPTED at zero since #421. Its one finding was a resolver false positive
      // on `import { v4 } from 'uuid'` in modules/auth/auth-service.ts; that
      // import is gone (crypto.randomUUID replaced the package), and the rule
      // reports nothing repo-wide.
      'import-x/named': 'error',
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
    // Component tests query the way a user does: rules/testing-rules.md §6
    // *React Testing Library Selector Rule*. `no-node-access` and `prefer-find-by`
    // are that rule enforced; the rest are the plugins' recommended sets.
    // Listed rather than spread so a plugin upgrade cannot add a rule here
    // unreviewed. `no-debugging-utils` is `warn` in the preset; it is `error`
    // here because `--max-warnings 0` would fail on it anyway.
    files: ['clients/poolmaster/src/**/*.{test,spec}.{ts,tsx}'],
    plugins: { 'testing-library': testingLibrary, 'jest-dom': jestDom },
    rules: {
      'testing-library/await-async-events': ['error', { eventModule: 'userEvent' }],
      'testing-library/await-async-queries': 'error',
      'testing-library/await-async-utils': 'error',
      'testing-library/no-await-sync-events': ['error', { eventModules: ['fire-event'] }],
      'testing-library/no-await-sync-queries': 'error',
      'testing-library/no-container': 'error',
      'testing-library/no-debugging-utils': 'error',
      'testing-library/no-dom-import': ['error', 'react'],
      'testing-library/no-global-regexp-flag-in-query': 'error',
      'testing-library/no-manual-cleanup': 'error',
      'testing-library/no-node-access': 'error',
      'testing-library/no-promise-in-fire-event': 'error',
      'testing-library/no-render-in-lifecycle': 'error',
      'testing-library/no-unnecessary-act': 'error',
      'testing-library/no-wait-for-multiple-assertions': 'error',
      'testing-library/no-wait-for-side-effects': 'error',
      'testing-library/no-wait-for-snapshot': 'error',
      'testing-library/prefer-find-by': 'error',
      'testing-library/prefer-presence-queries': 'error',
      'testing-library/prefer-query-by-disappearance': 'error',
      'testing-library/prefer-screen-queries': 'error',
      'testing-library/render-result-naming-convention': 'error',
      'jest-dom/prefer-checked': 'error',
      'jest-dom/prefer-empty': 'error',
      'jest-dom/prefer-enabled-disabled': 'error',
      'jest-dom/prefer-focus': 'error',
      'jest-dom/prefer-in-document': 'error',
      'jest-dom/prefer-required': 'error',
      'jest-dom/prefer-to-have-attribute': 'error',
      'jest-dom/prefer-to-have-class': 'error',
      'jest-dom/prefer-to-have-style': 'error',
      'jest-dom/prefer-to-have-text-content': 'error',
      'jest-dom/prefer-to-have-value': 'error',
    },
  },
  {
    // The Jest suites under tests/ entered the lint glob in #345 Phase 2 PR 1,
    // so these two rules now reach them. See the exemption block below for what
    // that widening is standing on.
    files: ['tests/**/*.{ts,tsx}'],
    plugins: { jest },
    // The two rules below do not read it, but any version-aware jest rule added
    // later would otherwise detect Jest from the cwd and throw "Unable to detect
    // Jest version" rather than report anything.
    settings: { jest: { version: 30 } },
    rules: {
      'jest/no-focused-tests': 'error',
      'jest/no-commented-out-tests': 'error',
    },
  },

  {
    // -------------------------------------------------------------------------
    // #345 Phase 2 PR 1 — `tests/**` joined the lint glob in this PR, and
    // `eslint.tests.config.mjs` (a second flat config running exactly one rule
    // over `tests/` with no type information) was deleted with it. Every
    // syntactic rule and all eleven of Phase 0's type-aware rules now reach the
    // 120-file test tree, and `poolmaster/no-disabled-tests` reaches it through
    // the main config with type information it never had before.
    //
    // This block is what lets the glob be live today. #345 records the owner's
    // ruling that switching the type-aware family off in `tests/` as POLICY is
    // declined -- a mock typed `any` does not break when the production
    // interface changes, so the suite keeps passing while the contract
    // underneath it moves. So two rules below are carve-outs and the
    // other five are debt with a schedule and a named owner.
    //
    // Measured on this branch, 2026-10-05, with the full config (not just
    // `recommendedTypeChecked`): 1476 findings across 64 of 120 files. PR 1
    // fixes 66 of them and exempts the rest under the schedule below.
    // -------------------------------------------------------------------------
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      // PERMANENT. 185 findings, and not one of them is the bug the rule is for.
      //
      // `unbound-method` exists because `const f = obj.method; f()` loses `this`
      // in production code. In a test the same expression is an assertion
      // idiom -- `expect(obj.method).toHaveBeenCalledWith(...)` passes the
      // reference to Jest, which reads the mock's call record off it and never
      // invokes it. There is no `this` to lose because there is no call.
      //
      // The alternatives were weighed and are worse: `ignoreStatic` does not
      // apply (these are instance methods on mocks), and
      // `expect(jest.mocked(obj).method)` would add 185 wrappers that change
      // nothing about what is asserted. typescript-eslint's own docs name the
      // Jest assertion as the canonical false positive for this rule.
      //
      // This and `require-await` below are the two exemptions #345's end state
      // keeps.
      '@typescript-eslint/unbound-method': 'off',

      // PERMANENT, settled in #345 Phase 2 PR 2. 178 findings, and the fix the rule
      // accepts is wrong for every one of them.
      //
      // The findings are `async` arrows implementing a port method that returns
      // `Promise<T>` -- the in-memory fakes in `tests/support/` and the
      // `mockFn<Port['method']>(async (...) => ...)` overrides. Their `async` is
      // the contract, not an oversight: with the doubles typed, deleting it is a
      // type error (tried on `invitation-service.test.ts`: 7 of 7 sites stop
      // compiling), and the only form the rule accepts is wrapping every body in
      // `Promise.resolve(...)`, which buys no correctness and reads worse.
      //
      // Before PR 2, 66 of PR 1's 181 compiled without `async` -- only because
      // `jest.fn().mockImplementation(...)` was `jest.Mock<any, any>`, so a double
      // returning `T` where the port returns `Promise<T>` went unnoticed. Typing
      // the doubles closed that hole; the rule was never what would have caught it.
      '@typescript-eslint/require-await': 'off',

      // ---------------------------------------------------------------------
      // #345 Phase 2 is complete: every other type-aware rule is on for tests/.
      // PR 2 turned on `no-unsafe-call` / `-return`, PR 3 `no-explicit-any`, and
      // PR 4 `no-unsafe-assignment` / `-member-access` / `-argument`.
      //
      // DO NOT clear a finding by writing `as X` or `as unknown as T`. That
      // satisfies the rule and makes the double LIE -- strictly worse than `any`,
      // which is at least visible. Type the double at its source;
      // `rules/testing-rules.md` §1B *Test doubles are typed by the contract they
      // stand in for* has the idioms, including importing `expect` from
      // `@jest/globals` where an asymmetric matcher sits in an object literal
      // (`@types/jest` types every matcher as `any`). Cast counts in `tests/`
      // after PR 4: `as any` 0, `as unknown as` 30, `: any` 0.
      // ---------------------------------------------------------------------
    },
  },
);
