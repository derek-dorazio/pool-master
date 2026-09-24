/**
 * RuleTester suite for the local plugin. Run directly (`node
 * eslint-rules/__tests__/run-rule-tests.mjs`) or via the Jest wrapper in
 * tests/unit/poolmaster/, which asserts this exits 0.
 *
 * It is a standalone script rather than a Jest test because the rules are ESM and
 * the backend suite transpiles to CommonJS -- the same reason the scanner tests
 * spawn their scripts instead of importing them.
 */
import { RuleTester } from 'eslint';
import tseslintParser from '@typescript-eslint/parser';

import noBareUiControls from '../no-bare-ui-controls.mjs';
import noDisabledTests from '../no-disabled-tests.mjs';
import noDuplicateExtractErrorMessage from '../no-duplicate-extract-error-message.mjs';
import noEnvFallbacks from '../no-env-fallbacks.mjs';
import noInlineQueryKeys from '../no-inline-query-keys.mjs';
import noParallelApiTypes from '../no-parallel-api-types.mjs';
import noWidenedEnumFields from '../no-widened-enum-fields.mjs';
import noBareEnumLiterals from '../no-bare-enum-literals.mjs';
import noInlineThemeStyles from '../no-inline-theme-styles.mjs';
import noMockedApi from '../no-mocked-api.mjs';

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('no-inline-query-keys', noInlineQueryKeys, {
  valid: [
    // The factory call is the whole point of the rule.
    "useQuery({ queryKey: QueryKeys.leagues.all(), queryFn: f });",
    // A non-array value is a different mistake, and not this rule's.
    "useQuery({ queryKey: someVariable, queryFn: f });",
    // A computed key that happens to evaluate to 'queryKey' is not a literal
    // property name; the scanner did not match it either.
    "useQuery({ [dynamic]: ['a'], queryFn: f });",
    // Arrays elsewhere are unrelated.
    "const other = { mutationKey: ['a'] };",
  ],
  invalid: [
    {
      code: "useQuery({ queryKey: ['a', 1], queryFn: f });",
      errors: [{ messageId: 'inlineQueryKey' }],
    },
    {
      // `as const` is the common shape and must not hide the array.
      code: "useQuery({ queryKey: ['a'] as const, queryFn: f });",
      errors: [{ messageId: 'inlineQueryKey' }],
    },
    {
      code: "useQuery({ queryKey: ['a'] satisfies readonly string[], queryFn: f });",
      errors: [{ messageId: 'inlineQueryKey' }],
    },
    {
      // A quoted property name is the same violation.
      code: "useQuery({ 'queryKey': ['a'], queryFn: f });",
      errors: [{ messageId: 'inlineQueryKey' }],
    },
    {
      code: "useQuery({ queryKey: (['a']), queryFn: f });",
      errors: [{ messageId: 'inlineQueryKey' }],
    },
  ],
});

ruleTester.run('no-mocked-api', noMockedApi, {
  valid: [
    // Mocking something that is not the generated boundary is fine.
    "vi.mock('./local-helper');",
    "jest.mock('node:fs');",
    // A near-miss module name must not match.
    "vi.mock('@/lib/api-helpers');",
    // Not a mock call.
    "vi.spyOn(api, 'listLeagues');",
  ],
  invalid: [
    {
      code: "vi.mock('@/lib/api');",
      errors: [{ messageId: 'mockedApi' }],
    },
    {
      code: "vi.mock('@/lib/api-client');",
      errors: [{ messageId: 'mockedApi' }],
    },
    {
      // Widened past the scanner, which only matched `vi`. The backend runs Jest.
      code: "jest.mock('@/lib/api');",
      errors: [{ messageId: 'mockedApi' }],
    },
  ],
});

ruleTester.run('no-bare-ui-controls', noBareUiControls, {
  valid: [
    // Shared primitives are the point.
    'const a = <Button onClick={f}>go</Button>;',
    'const b = <Input value={v} onChange={f} />;',
    // A DOM element that is not one of the three.
    'const c = <div role="button" />;',
  ],
  invalid: [
    { code: 'const a = <button type="button">go</button>;', errors: [{ messageId: 'bareControl' }] },
    { code: 'const b = <input value="" readOnly />;', errors: [{ messageId: 'bareControl' }] },
    { code: 'const c = <textarea readOnly />;', errors: [{ messageId: 'bareControl' }] },
  ],
});

ruleTester.run('no-duplicate-extract-error-message', noDuplicateExtractErrorMessage, {
  valid: [
    // Importing and calling the canonical one is the intended usage.
    "import { extractErrorMessage } from '@/lib/errors';",
    "const msg = extractErrorMessage(error, { fallback: 'x' });",
    // A wrapper that calls it is fine -- only fresh definitions are flagged.
    'function showError(e) { return extractErrorMessage(e); }',
    // A same-named property is not a definition.
    'const handlers = { extractErrorMessage: someImportedFn };',
  ],
  invalid: [
    {
      code: 'function extractErrorMessage(e) { return String(e); }',
      errors: [{ messageId: 'duplicateExtractor' }],
    },
    {
      code: 'const extractErrorMessage = (e) => String(e);',
      errors: [{ messageId: 'duplicateExtractor' }],
    },
    {
      code: 'export async function extractErrorMessage(e) { return String(e); }',
      errors: [{ messageId: 'duplicateExtractor' }],
    },
  ],
});

ruleTester.run('no-inline-theme-styles', noInlineThemeStyles, {
  valid: [
    // A computed value is what the rule pushes toward.
    'const a = <span style={{ color: theme.accent }} />;',
    // Not a theme-bearing prop, whatever the value.
    'const b = <span style={{ gap: 8 }} />;',
    // A template WITH interpolation is computed, not hardcoded.
    'const c = <span style={{ color: `var(--${name})` }} />;',
    // Not a style prop.
    'const d = <span data-color="#fff" />;',
  ],
  invalid: [
    { code: "const a = <span style={{ color: '#fff' }} />;", errors: [{ messageId: 'inlineThemeStyle' }] },
    // The plan called this rule "raw color literals"; it is not. A number on a
    // theme-bearing prop is a violation too, and dropping these was the risk.
    { code: 'const b = <span style={{ fontSize: 14 }} />;', errors: [{ messageId: 'inlineThemeStyle' }] },
    { code: "const c = <span style={{ color: 'inherit' }} />;", errors: [{ messageId: 'inlineThemeStyle' }] },
    { code: 'const d = <span style={{ background: `red` }} />;', errors: [{ messageId: 'inlineThemeStyle' }] },
  ],
});

console.log('Local ESLint rule tests passed.');

ruleTester.run('no-env-fallbacks', noEnvFallbacks, {
  valid: [
    // An empty fallback is a "not configured" sentinel, not a default identity.
    "const x = process.env.SES_CONFIGURATION_SET ?? '';",
    // Tunables: a wrong number is not a deployment lying about what it is.
    'const x = Number(process.env.PORT ?? 3000);',
    'const x = process.env.POOL_SIZE ?? DEFAULT_POOL_SIZE;',
    'const x = process.env.GIT_REF ?? null;',
    // A chain with no literal tail is the bootstrap reader's own shape.
    'const x = process.env.RELEASE_VERSION || process.env.APP_VERSION;',
    // A literal fallback on something that is not an env read is unrelated.
    "const x = config.name ?? 'default';",
    // The allow option is how a genuine tunable opts out.
    {
      code: "const x = process.env.LOG_LEVEL ?? 'info';",
      options: [{ allow: ['LOG_LEVEL'] }],
    },
    // Logical assignment with a non-fallback right-hand side.
    "process.env.OK ??= '';",
    'process.env.PORT ??= 3000;',
    // A plain assignment sets a value, it does not absorb a missing one.
    "process.env.PLAIN = 'assigned';",
  ],
  invalid: [
    // The shape the line-based scanner failed open on: the read and the literal
    // never share a physical line, so its per-line regex never saw both.
    {
      code: "const x = process.env.APP_ENV\n  ?? process.env.NODE_ENV\n  ?? 'development';",
      errors: [{ messageId: 'envFallback', data: { name: 'APP_ENV' } }],
    },
    // The other shape it missed: its regex required [A-Z_][A-Z0-9_]*.
    {
      code: "const x = process.env.npm_package_version ?? '0.1.0';",
      errors: [{ messageId: 'envFallback', data: { name: 'npm_package_version' } }],
    },
    // Computed access is the same read.
    {
      code: "const x = process.env['APP_ENV'] ?? 'development';",
      errors: [{ messageId: 'envFallback' }],
    },
    // A conditional tail is a fallback with extra steps -- the obvious way
    // around a rule that only looks for a bare literal.
    {
      code: "const x = process.env.APP_ENV ?? (isCi ? 'ci' : 'development');",
      errors: [{ messageId: 'envFallback' }],
    },
    // `||` absorbs a miss just as `??` does.
    {
      code: "const x = process.env.APP_ENV || 'development';",
      errors: [{ messageId: 'envFallback' }],
    },
    // The baseline the scanner did catch, kept so the migration is provably
    // a superset rather than a trade.
    {
      code: "const x = process.env.JWT_SECRET ?? 'poolmaster-dev-secret';",
      errors: [{ messageId: 'envFallback' }],
    },
    {
      code: 'const x = process.env.JWT_SECRET ?? `dev-secret`;',
      errors: [{ messageId: 'envFallback' }],
    },
    // A chain reports once, not once per operand.
    {
      code: "const x = process.env.A ?? process.env.B ?? 'lit';",
      errors: [{ messageId: 'envFallback', data: { name: 'A' } }],
    },
    // Logical ASSIGNMENT is the same defect in a different node type. The first
    // version of this rule walked only LogicalExpression and missed it entirely.
    {
      code: "process.env.POOLMASTER_ENVIRONMENT ??= 'development';",
      errors: [{ messageId: 'envFallback', data: { name: 'POOLMASTER_ENVIRONMENT' } }],
    },
    {
      code: "process.env.FOO ||= 'bar';",
      errors: [{ messageId: 'envFallback', data: { name: 'FOO' } }],
    },
  ],
});

ruleTester.run('no-disabled-tests', noDisabledTests, {
  valid: [
    "describe('suite', () => {});",
    "it('runs', () => {});",
    "test('runs', () => {});",
    "it.each([1, 2])('runs %s', () => {});",
    // `concurrent` changes scheduling, not whether the test runs.
    "it.concurrent('runs', () => {});",
    // `.skip` on something that is not a test runner is unrelated.
    "obj.skip('not a runner');",
    "lodash.pending();",
  ],
  invalid: [
    {
      code: "describe.skip('suite', () => {});",
      errors: [{ messageId: 'disabledTest', data: { form: 'describe.skip' } }],
    },
    {
      code: "it.skip('t', () => {});",
      errors: [{ messageId: 'disabledTest', data: { form: 'it.skip' } }],
    },
    {
      code: "test.todo('t');",
      errors: [{ messageId: 'disabledTest', data: { form: 'test.todo' } }],
    },
    {
      code: "it.fails('t', () => {});",
      errors: [{ messageId: 'disabledTest' }],
    },
    {
      code: "it.failing('t', () => {});",
      errors: [{ messageId: 'disabledTest' }],
    },
    {
      code: "xit('t', () => {});",
      errors: [{ messageId: 'disabledTest', data: { form: 'xit' } }],
    },
    {
      code: "xdescribe('s', () => {});",
      errors: [{ messageId: 'disabledTest' }],
    },
    {
      code: 'pending();',
      errors: [{ messageId: 'disabledTest', data: { form: 'pending()' } }],
    },
    // The chained form the line-based scanner's regex did not anticipate.
    {
      code: "it.skip.each([1])('t %s', () => {});",
      errors: [{ messageId: 'disabledTest' }],
    },
    // The policy change: a SKIP marker is no longer an escape.
    {
      code: "// SKIP: #123\nit.skip('t', () => {});",
      errors: [{ messageId: 'disabledTest' }],
    },
  ],
});

// This rule reads the generated type names from disk, so its cases depend on the
// real `packages/shared/generated/hey-api/types.gen.ts` rather than fixtures. The
// names below are asserted to exist first, so a regeneration that removes one
// fails loudly here instead of turning these cases into silent no-ops.
const GENERATED_SAMPLE = ['GetHealthData', 'GetRootVersionResponse', 'ClientOptions'];
{
  const { Linter } = await import('eslint');
  const linter = new Linter();
  const stale = GENERATED_SAMPLE.filter((name) => {
    const messages = linter.verify(`interface ${name} { a: string }`, [
      {
        files: ['**/*.ts'],
        plugins: { poolmaster: { rules: { r: noParallelApiTypes } } },
        languageOptions: { parser: tseslintParser },
        rules: { 'poolmaster/r': 'error' },
      },
    ], 'clients/poolmaster/src/probe.ts');
    // Match the rule's own finding, not just "some message" -- a config or parse
    // error also produces one, which is how the first version of this guard
    // managed to pass while checking nothing.
    return !messages.some((m) => m.messageId === 'parallelType');
  });
  if (stale.length > 0) {
    throw new Error(
      `no-parallel-api-types test fixtures are stale: ${stale.join(', ')} is no longer a `
      + 'generated hey-api type. Pick current names from '
      + 'packages/shared/generated/hey-api/types.gen.ts.',
    );
  }
}

ruleTester.run('no-parallel-api-types', noParallelApiTypes, {
  valid: [
    // A name the generator does not emit is just an ordinary local type.
    'interface NotAGeneratedName { a: string }',
    'type AlsoNotGenerated = { a: string };',
    // A value binding that happens to share a generated name is not a type.
    'const GetHealthResponses = 1;',
    // Importing the generated type is the intended usage.
    "import type { GetHealthData } from '@poolmaster/shared';",
  ],
  invalid: [
    {
      code: 'interface GetHealthData { a: string }',
      errors: [{ messageId: 'parallelType', data: { name: 'GetHealthData' } }],
    },
    {
      code: 'type GetRootVersionResponse = { a: string };',
      errors: [{ messageId: 'parallelType' }],
    },
    // A non-exported local shadow is the same drift.
    {
      code: 'type ClientOptions = { a: string };',
      errors: [{ messageId: 'parallelType' }],
    },
  ],
});

// Reads schema.prisma, so the fixtures below name real columns. `role` is an enum on
// every model that declares it; `status` is an enum on some and String on others, which
// is exactly the case the rule must NOT flag.
ruleTester.run('no-widened-enum-fields', noWidenedEnumFields, {
  valid: [
    // Already the enum type.
    'interface R { role: LeagueRole }',
    // Not an enum column at all.
    'interface R { name: string }',
    'interface R { id: string }',
    // `status` is String on Contest/DraftSession/ContestEntry, so a hand-written row
    // typing it `string` may well be correct — the rule cannot tell which model it
    // mirrors, so it stays silent rather than guessing.
    'interface R { status: string }',
    // Same ambiguity for contestFormat (String on ContestConfigTemplate/ContestTimingPolicy).
    'interface R { contestFormat: string }',
    // A non-string annotation is a different question.
    'interface R { role: number }',
  ],
  invalid: [
    {
      code: 'interface R { role: string }',
      errors: [{ messageId: 'widenedEnum', data: { name: 'role', enums: 'PrismaLeagueRole' } }],
    },
    {
      code: 'interface R { participantType: string }',
      errors: [{ messageId: 'widenedEnum' }],
    },
    {
      code: 'interface R { syncScope: string }',
      errors: [{ messageId: 'widenedEnum' }],
    },
    {
      // Nested inline object literals count — that is where row shapes hide.
      code: 'function f(x: { league: { joinPolicy: string } }) { return x; }',
      errors: [{ messageId: 'widenedEnum' }],
    },
  ],
});

ruleTester.run('no-bare-enum-literals', noBareEnumLiterals, {
  valid: [
    // Naming the member is the point of the rule.
    'const a = x.syncScope === SportEventSyncScope.FULL;',
    // `status` is String on six models, so a literal there has no enum to name.
    "const a = x.status === 'ACTIVE';",
    // Not an enum-backed column.
    "const a = x.name === 'FULL';",
    // A value that is not a member of the column's enum is a different bug (tsc's).
    "const a = x.syncScope === 'NOT_A_MEMBER';",
    // Not a comparison this rule owns.
    "const a = x.syncScope > 'FULL';",
  ],
  invalid: [
    {
      code: "const a = x.syncScope === 'FULL';",
      errors: [{ messageId: 'bareLiteral', data: { field: 'syncScope', value: 'FULL' } }],
    },
    {
      code: "const a = x.confidence !== 'EXACT';",
      errors: [{ messageId: 'bareLiteral' }],
    },
    {
      // Reversed operands — the literal can sit on either side.
      code: "const a = 'COMMISSIONER' === x.role;",
      errors: [{ messageId: 'bareLiteral' }],
    },
  ],
});
