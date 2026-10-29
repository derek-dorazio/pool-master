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
import noButtonRowOverride from '../no-button-row-override.mjs';
import noDisabledTests from '../no-disabled-tests.mjs';
import noDuplicateExtractErrorMessage from '../no-duplicate-extract-error-message.mjs';
import noEnvFallbacks from '../no-env-fallbacks.mjs';
import noInlineQueryKeys from '../no-inline-query-keys.mjs';
import noParallelApiTypes from '../no-parallel-api-types.mjs';
import noWidenedEnumFields from '../no-widened-enum-fields.mjs';
import noBareEnumLiterals from '../no-bare-enum-literals.mjs';
import noInlineThemeStyles from '../no-inline-theme-styles.mjs';
import noMockedApi from '../no-mocked-api.mjs';
import noNodeEnvReads from '../no-node-env-reads.mjs';
import noSportBranching from '../no-sport-branching.mjs';
import noPlanBranching from '../no-plan-branching.mjs';
import noArbitraryTypeSizes from '../no-arbitrary-type-sizes.mjs';
import noRawThemeColors from '../no-raw-theme-colors.mjs';
import noUnawaitedSendError from '../no-unawaited-send-error.mjs';
import noQueryInLoop from '../no-query-in-loop.mjs';
import noListLookup from '../no-list-lookup.mjs';

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

ruleTester.run('no-raw-theme-colors', noRawThemeColors, {
  valid: [
    // Semantic tokens are what the rule pushes toward.
    'const a = <div className="bg-primary text-muted-foreground border-border" />;',
    // An issue number in a comment is not a colour. The scanner's regex pass
    // reported `#206` here, which cost two PRs a lint round each.
    '// see #206 and #abc\nconst b = 1;',
    '/* #fff */ const c = 2;',
    // A colour scale name without a shade is not a raw scale class.
    "const d = 'text-red';",
    // Not a colour-bearing utility prefix.
    "const e = 'p-500 gap-200';",
  ],
  invalid: [
    {
      code: 'const a = <div className="rounded bg-red-500 text-slate-700/80" />;',
      errors: [{ messageId: 'rawThemeColor', data: { matches: 'bg-red-500, text-slate-700/80' } }],
    },
    { code: "const b = cn('p-2', 'border-gray-200');", errors: [{ messageId: 'rawThemeColor' }] },
    // Template chunks are checked; the interpolation itself is not a literal.
    { code: 'const c = `ring-blue-300 ${extra}`;', errors: [{ messageId: 'rawThemeColor' }] },
    { code: "const d = { color: '#1a2b3c' };", errors: [{ messageId: 'rawThemeColor' }] },
    { code: "const e = 'rgba(0, 0, 0, 0.5)';", errors: [{ messageId: 'rawThemeColor' }] },
    { code: 'const f = <span>hsl(10, 20%, 30%)</span>;', errors: [{ messageId: 'rawThemeColor' }] },
  ],
});

ruleTester.run('no-button-row-override', noButtonRowOverride, {
  valid: [
    // The row layout is what the rule pushes toward.
    'const a = <Button className="justify-between" layout="row">Alpha</Button>;',
    // The same classes on something that is not a Button are not this rule's.
    'const b = <span className="normal-case tracking-normal">Needs review</span>;',
    // A longer class that merely starts with the name is a different class.
    'const c = <Button className="tracking-normal-ish">Go</Button>;',
  ],
  invalid: [
    {
      code: '<Button className="normal-case tracking-normal w-full text-left">Alpha</Button>;',
      errors: [{ messageId: 'rowOverride' }],
    },
    {
      // Passed through cn() and a conditional, it is still the hand-typed override.
      code: "<LinkButton className={cn(open ? 'normal-case' : null, base)} to='/x'>Open</LinkButton>;",
      errors: [{ messageId: 'rowOverride' }],
    },
    {
      code: '<MenuItem className={`sm:tracking-normal ${x}`}>Remove owner</MenuItem>;',
      errors: [{ messageId: 'rowOverride' }],
    },
  ],
});

ruleTester.run('no-arbitrary-type-sizes', noArbitraryTypeSizes, {
  valid: [
    // Theme spacing names and Tailwind's size steps are what the rule pushes toward.
    'const a = <div className="text-xs tracking-eyebrow uppercase" />;',
    // An arbitrary colour in text-[…] is a colour, not a size.
    "const b = 'text-[color:var(--status-warning-text)]';",
    "const b2 = 'text-[var(--status-warning-text)]';",
    // Other arbitrary values are not this rule's.
    "const c = 'aspect-[5/2] rounded-[inherit]';",
    // A comment is never a class.
    '// tracking-[0.2em] text-[11px]\nconst d = 1;',
  ],
  invalid: [
    {
      code: 'const a = <p className="text-[11px] font-semibold tracking-[0.18em]" />;',
      errors: [{ messageId: 'arbitraryTypeSize', data: { matches: 'text-[11px], tracking-[0.18em]' } }],
    },
    { code: "const b = cn('p-2', 'sm:text-[0.7rem]');", errors: [{ messageId: 'arbitraryTypeSize' }] },
    { code: 'const c = `tracking-[.06em] ${extra}`;', errors: [{ messageId: 'arbitraryTypeSize' }] },
    // Every size form, not only a bare length.
    { code: "const d = 'text-[length:12px]';", errors: [{ messageId: 'arbitraryTypeSize' }] },
    { code: "const e = 'text-[clamp(1rem,2vw,2rem)]';", errors: [{ messageId: 'arbitraryTypeSize' }] },
    { code: "const f = 'text-[2vw]';", errors: [{ messageId: 'arbitraryTypeSize' }] },
  ],
});

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

ruleTester.run('no-node-env-reads', noNodeEnvReads, {
  valid: [
    // The one variable our code reads for which environment this is.
    'const env = process.env.POOLMASTER_ENVIRONMENT;',
    'const level = process.env.LOG_LEVEL;',
    // A different name that merely contains it.
    'const x = process.env.NODE_ENV_LABEL;',
  ],
  invalid: [
    { code: "if (process.env.NODE_ENV === 'production') {}", errors: [{ messageId: 'nodeEnvRead' }] },
    // The injected-env shape backend code uses.
    { code: "const runtime = env.NODE_ENV ?? '';", errors: [{ messageId: 'nodeEnvRead' }] },
    { code: "const runtime = process.env['NODE_ENV'];", errors: [{ messageId: 'nodeEnvRead' }] },
    { code: 'const { NODE_ENV } = process.env;', errors: [{ messageId: 'nodeEnvRead' }] },
    { code: "const { 'NODE_ENV': mode } = process.env;", errors: [{ messageId: 'nodeEnvRead' }] },
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
    // Reading the TestInfo is not skipping the test.
    "test('t', async ({ page }, testInfo) => { void testInfo.project.use.baseURL; });",
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
    // Playwright's own skip, in the e2e suites since #616.
    {
      code: "test.fixme('t', async () => {});",
      errors: [{ messageId: 'disabledTest', data: { form: 'test.fixme' } }],
    },
    {
      code: "test.describe.fixme('suite', () => {});",
      errors: [{ messageId: 'disabledTest' }],
    },
    // Playwright's expected-failure marker, its `it.fails` (#634).
    {
      code: "test.fail('t', async () => {});",
      errors: [{ messageId: 'disabledTest', data: { form: 'test.fail' } }],
    },
    {
      code: "test('t', async () => { test.fail(); });",
      errors: [{ messageId: 'disabledTest', data: { form: 'test.fail' } }],
    },
    // The same three on the TestInfo a test receives (#634).
    {
      code: "test('t', async ({ page }, testInfo) => { testInfo.skip(); });",
      errors: [{ messageId: 'disabledTest', data: { form: 'testInfo.skip' } }],
    },
    {
      code: "test('t', async ({ page }, testInfo) => { testInfo.fixme(true, 'why'); });",
      errors: [{ messageId: 'disabledTest', data: { form: 'testInfo.fixme' } }],
    },
    {
      code: "test('t', async ({ page }, testInfo) => { testInfo.fail(); });",
      errors: [{ messageId: 'disabledTest', data: { form: 'testInfo.fail' } }],
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

// Reads schema.prisma, so the fixtures below name real columns. `inviteType` is an enum on
// every model that declares it; `status` is an enum on some and String on others, which
// is exactly the case the rule must NOT flag. `role` became that case too in #246:
// LeagueMembership.role is an enum, Participant.role (a playing role) is a String.
ruleTester.run('no-widened-enum-fields', noWidenedEnumFields, {
  valid: [
    // Already the enum type.
    'interface R { role: LeagueRole }',
    // Not an enum column at all.
    'interface R { name: string }',
    'interface R { id: string }',
    // A non-string annotation is a different question.
    'interface R { role: number }',
    // `role` is String on Participant, so a row typing it `string` may be correct.
    'interface R { role: string }',
  ],
  invalid: [
    // #186 made `status` and `contestFormat` an enum on every model that declares them,
    // so the rule now covers both with no edit to it.
    {
      code: 'interface R { status: string }',
      errors: [{ messageId: 'widenedEnum' }],
    },
    {
      code: 'interface R { contestFormat: string }',
      errors: [{ messageId: 'widenedEnum', data: { name: 'contestFormat', enums: 'PrismaContestFormat' } }],
    },
    {
      code: 'interface R { inviteType: string }',
      errors: [{ messageId: 'widenedEnum', data: { name: 'inviteType', enums: 'PrismaLeagueInviteType' } }],
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
      code: 'function f(x: { invitation: { inviteType: string } }) { return x; }',
      errors: [{ messageId: 'widenedEnum' }],
    },
  ],
});

ruleTester.run('no-bare-enum-literals', noBareEnumLiterals, {
  valid: [
    // Naming the member is the point of the rule.
    'const a = x.syncScope === SportEventSyncScope.SCORES_ONLY;',
    // Not an enum-backed column.
    "const a = x.name === 'SCORES_ONLY';",
    // A value that is not a member of the column's enum is a different bug (tsc's).
    "const a = x.syncScope === 'NOT_A_MEMBER';",
    // Not a comparison this rule owns.
    "const a = x.syncScope > 'SCORES_ONLY';",
  ],
  invalid: [
    {
      // #186 made `status` an enum on every model, so it is covered with no edit to the rule.
      code: "const a = x.status === 'ACTIVE';",
      errors: [{ messageId: 'bareLiteral', data: { field: 'status', value: 'ACTIVE' } }],
    },
    {
      code: "const a = x.syncScope === 'SCORES_ONLY';",
      errors: [{ messageId: 'bareLiteral', data: { field: 'syncScope', value: 'SCORES_ONLY' } }],
    },
    {
      code: "const a = x.confidence !== 'EXACT';",
      errors: [{ messageId: 'bareLiteral' }],
    },
    {
      // Reversed operands — the literal can sit on either side.
      code: "const a = 'LINK' === x.inviteType;",
      errors: [{ messageId: 'bareLiteral' }],
    },
  ],
});

ruleTester.run('no-unawaited-send-error', noUnawaitedSendError, {
  valid: [
    'async function gate(reply) { await sendError(reply, 403, "X", "x"); return; }',
    'function handler(reply) { return sendError(reply, 404, "X", "x"); }',
    'const handler = (reply) => sendError(reply, 400, "X", "x");',
    'async function gate(reply) { const sent = sendError(reply, 403, "X", "x"); await sent; }',
    // A different function with a similar name is not this rule's concern.
    'async function gate(reply) { void sendErrorLater(reply); }',
    // The last operand of a sequence is its value.
    'function handler(reply) { return (log(), sendError(reply, 400, "X", "x")); }',
  ],
  invalid: [
    {
      // The #193 shape: the hook resolves before the reply has finished.
      code: 'async function gate(reply) { void sendError(reply, 403, "X", "x"); return; }',
      errors: [{ messageId: 'unawaitedSendError' }],
    },
    {
      code: 'async function gate(reply) { sendError(reply, 403, "X", "x"); }',
      errors: [{ messageId: 'unawaitedSendError' }],
    },
    {
      code: 'async function gate(reply) { void errors.sendError(reply, 403, "X", "x"); }',
      errors: [{ messageId: 'unawaitedSendError' }],
    },
    {
      // A cast does not change that the value is thrown away.
      code: 'async function gate(reply) { void (sendError(reply, 403, "X", "x") as unknown); }',
      errors: [{ messageId: 'unawaitedSendError' }],
    },
    {
      code: 'async function gate(reply) { sendError(reply, 403, "X", "x"), log(); }',
      errors: [{ messageId: 'unawaitedSendError' }],
    },
  ],
});

ruleTester.run('no-sport-branching', noSportBranching, {
  valid: [
    // Comparing two sport values is a lookup, not a branch on one sport.
    'const same = event.sport === row.sport;',
    // Naming a sport as an argument is not a comparison.
    'const golf = findSportRow(rows, Sport.GOLF);',
    // Other fields compared to literals are other rules' business.
    "const live = result.category === 'GOLF';",
    'switch (event.status) { case Status.OPEN: break; }',
  ],
  invalid: [
    { code: 'if (event.sport === Sport.GOLF) {}', errors: [{ messageId: 'sportBranch' }] },
    { code: 'if (Sport.GOLF !== sport) {}', errors: [{ messageId: 'sportBranch' }] },
    { code: "if (event.sport !== 'GOLF') {}", errors: [{ messageId: 'sportBranch' }] },
    { code: "const isGolf = 'GOLF' == sport;", errors: [{ messageId: 'sportBranch' }] },
    { code: 'switch (event.sport) { default: break; }', errors: [{ messageId: 'sportBranch' }] },
    { code: 'switch (kind) { case Sport.GOLF: break; }', errors: [{ messageId: 'sportBranch' }] },
  ],
});

ruleTester.run('no-plan-branching', noPlanBranching, {
  valid: [
    // Comparing two plan values is "did the plan change", not a branch on one plan.
    'const changed = league.plan !== previous.plan;',
    // Naming a plan as an argument is not a comparison.
    'const free = entitlements.forPlan(LeaguePlan.FREE);',
    // Other fields compared to literals are other rules' business.
    "const open = contest.status === 'OPEN';",
    'switch (contest.status) { case Status.OPEN: break; }',
    // Listing every plan is iteration, not a comparison.
    'const rows = LEAGUE_PLANS.map((plan) => limits[plan]);',
    'const known = OTHER_LIST.includes(plan);',
  ],
  invalid: [
    { code: 'const paid = LEAGUE_PLANS.indexOf(league.plan) >= 1;', errors: [{ messageId: 'planBranch' }] },
    { code: 'if (LEAGUE_PLANS.includes(plan)) {}', errors: [{ messageId: 'planBranch' }] },
    { code: 'if (league.plan === LeaguePlan.FREE) {}', errors: [{ messageId: 'planBranch' }] },
    { code: 'if (LeaguePlan.PLATINUM !== plan) {}', errors: [{ messageId: 'planBranch' }] },
    { code: "if (league.plan !== 'PRO') {}", errors: [{ messageId: 'planBranch' }] },
    { code: 'const paid = rank(plan) >= LeaguePlan.PRO;', errors: [{ messageId: 'planBranch' }] },
    { code: 'switch (league.plan) { default: break; }', errors: [{ messageId: 'planBranch' }] },
    { code: 'switch (kind) { case LeaguePlan.FREE: break; }', errors: [{ messageId: 'planBranch' }] },
  ],
});

ruleTester.run('no-query-in-loop', noQueryInLoop, {
  valid: [
    // The batched read the rule's message asks for: one IN query, then a map.
    'async function f(ids) { const rows = await this.contestRepo.findByIds(ids); return ids.map((id) => rows.find((row) => row.id === id)); }',
    'async function f(ids) { const rows = await prisma.contest.findMany({ where: { id: { in: ids } } }); for (const row of rows) { use(row); } }',
    // A set-based write built in a loop and sent once.
    'async function f(rows) { await tx.standing.createMany({ data: rows.map((row) => ({ id: row.id })) }); }',
    // The iterable of for...of and a for initialiser run once.
    'async function f() { for (const row of await this.contestRepo.list()) { use(row); } }',
    'async function f() { for (let rows = await squadRepo.list(); rows.length > 0; rows.pop()) { use(rows); } }',
    // A function stored inside a loop is a boundary: whoever calls it owns the loop.
    'for (const id of ids) { const load = async () => squadRepo.findById(id); loaders.push(load); }',
    'for (const id of ids) { loaders.push(async function load() { return squadRepo.findById(id); }.bind(null)); }',
    // A memo inside a loop reads once.
    'async function f(rows) { let games; for (const row of rows) { games ??= await this.matchRepo.findBySportEvent(id); use(row, games); } }',
    'async function f(rows) { let leagues; for (const row of rows) { leagues ||= await prisma.league.findMany(); use(row, leagues); } }',
    // Not a repository and not Prisma: other per-row calls are not this rule's business.
    'async function f(rows) { for (const row of rows) { await this.email.send(row); } }',
    'async function f(rows) { await Promise.all(rows.map((row) => this.mapper.toDto(row))); }',
    // A Prisma call that is not a delegate method (a transaction opener) is not a query per row.
    'async function f(rows) { for (const row of rows) { await prisma.$transaction(async () => undefined); } }',
    // The escape hatch with a reason, before the call or before the statement holding it.
    `async function f(rounds) {
      for (const round of rounds) {
        // poolmaster-allow-query-in-loop: a sport's handful of scoring periods
        await this.roundRepo.save(round);
      }
    }`,
    // A block comment works as a marker too.
    `async function f(rounds) {
      for (const round of rounds) {
        /* poolmaster-allow-query-in-loop: a sport's handful of scoring periods */
        await this.roundRepo.save(round);
      }
    }`,
    `async function f(rows) {
      // poolmaster-allow-query-in-loop: #1172
      await Promise.all(rows.map((row) =>
        prisma.standing.upsert({ where: { id: row.id }, create: row, update: row })));
    }`,
  ],
  invalid: [
    {
      code: 'async function f(ids) { for (const id of ids) { await this.contestRepo.findById(id); } }',
      errors: [{ messageId: 'queryInLoop' }],
    },
    {
      code: 'async function f(ids) { for (let i = 0; i < ids.length; i++) { await input.squadRepository.findById(ids[i]); } }',
      errors: [{ messageId: 'queryInLoop' }],
    },
    {
      // A while test runs once per iteration too.
      code: 'async function f() { while (await this.jobRepo.claimNext()) { work(); } }',
      errors: [{ messageId: 'queryInLoop' }],
    },
    {
      code: 'async function f() { do { await tx.contest.update({ where: { id }, data: {} }); } while (more()); }',
      errors: [{ messageId: 'queryInLoop' }],
    },
    {
      // The fan-out: Promise.all over a map is still one query per row.
      code: 'async function f(ids) { await Promise.all(ids.map((id) => this.prisma.user.findUnique({ where: { id } }))); }',
      errors: [{ messageId: 'queryInLoop' }],
    },
    {
      // A memo declared inside the loop starts empty on every pass.
      code: 'async function f(rows) { for (const row of rows) { let games; games ??= await this.matchRepo.findBySportEvent(row.id); use(games); } }',
      errors: [{ messageId: 'queryInLoop' }],
    },
    {
      // A property memo is a different object on every pass.
      code: 'async function f(rows) { for (const row of rows) { row.contest ??= await this.contestRepo.findById(row.id); } }',
      errors: [{ messageId: 'queryInLoop' }],
    },
    {
      code: 'async function f(rows) { await Promise.all(rows.map(async (row) => { let league; league ||= await leagueRepo.findById(row.leagueId); return league; })); }',
      errors: [{ messageId: 'queryInLoop' }],
    },
    {
      // A plain assignment is not a memo: it reads on every pass.
      code: 'async function f(rows) { let games; for (const row of rows) { games = await this.matchRepo.findBySportEvent(row.id); } }',
      errors: [{ messageId: 'queryInLoop' }],
    },
    {
      code: 'async function f(rows) { rows.forEach(async (row) => { await repo.save(row); }); }',
      errors: [{ messageId: 'queryInLoop' }],
    },
    {
      code: 'async function f(rows) { await Promise.all(rows.flatMap((row) => [tx.entry.delete({ where: { id: row.id } })])); }',
      errors: [{ messageId: 'queryInLoop' }],
    },
    {
      code: 'async function f(rows) { await rows.reduce(async (prev, row) => { await prev; await this.entryRepo.save(row); }, Promise.resolve()); }',
      errors: [{ messageId: 'queryInLoop' }],
    },
    {
      // A callback handed to another call runs where it is written: still inside the loop.
      code: 'async function f(rows) { for (const row of rows) { await prisma.$transaction(async (tx) => tx.entry.create({ data: row })); } }',
      errors: [{ messageId: 'queryInLoop' }],
    },
    {
      code: 'async function f(rows) { for (const row of rows) { await prisma.$executeRaw`UPDATE x SET y = ${row.y}`; } }',
      errors: [{ messageId: 'queryInLoop' }],
    },
    {
      // A marker without a reason is an error of its own, and does not excuse the call.
      code: `async function f(rows) {
        for (const row of rows) {
          // poolmaster-allow-query-in-loop:
          await this.entryRepo.save(row);
        }
      }`,
      errors: [{ messageId: 'missingReason' }],
    },
    {
      // A marker that covers nothing must go: a fix removes its own comment.
      code: `async function f(ids) {
        // poolmaster-allow-query-in-loop: #1172
        await this.contestRepo.findByIds(ids);
      }`,
      errors: [{ messageId: 'unusedAllow' }],
    },
    {
      // A marker two lines up covers nothing, and the call is still reported.
      code: `async function f(rows) {
        // poolmaster-allow-query-in-loop: #1172

        for (const row of rows) { await this.entryRepo.save(row); }
      }`,
      errors: [{ messageId: 'unusedAllow' }, { messageId: 'queryInLoop' }],
    },
  ],
});

// The same rule with type information, as `npm run lint` runs it: a repository reached under a
// name that does not say so (`this.deps.eventStandings`) is recognised by its declared type.
const typedRuleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
    parserOptions: {
      project: './tsconfig.json',
      // CI=true otherwise switches typescript-eslint to single-run mode, which builds the program
      // once from the fixture on disk and never sees each case's code.
      disallowAutomaticSingleRunInference: true,
      tsconfigRootDir: new URL('./fixtures/', import.meta.url).pathname,
    },
  },
});
const typedFixture = new URL('./fixtures/typed.ts', import.meta.url).pathname;
const typedDeclarations = `
  interface EventStandingRepository { upsert(row: { id: string }): Promise<void>; }
  interface Mailer { send(row: { id: string }): Promise<void>; }
  interface ContestDelegate { update(args: { where: { id: string } }): Promise<void>; }
  interface SquadRepository { findById(id: string): Promise<void>; list(): Promise<void>; }
  interface PredictionRepository { save(row: { id: string }): Promise<void>; }
  interface PrismaClient { $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>; $executeRawUnsafe(query: string): Promise<number>; }
  type Ports = { predictions: Pick<PredictionRepository, 'save'> };
  type Extra = { predictions: Readonly<{ count(): number }> };
  declare const deps: {
    eventStandings: EventStandingRepository;
    mailer: Mailer;
    store: { contest: ContestDelegate };
    squads: Pick<SquadRepository, 'findById'>;
    partial: Partial<Omit<SquadRepository, 'list'>>;
    predictions: Ports['predictions'] & Extra['predictions'];
    db: PrismaClient;
  };
  declare const rows: Array<{ id: string }>;
`;

typedRuleTester.run('no-query-in-loop (typed)', noQueryInLoop, {
  valid: [
    {
      // Typed as something other than a repository: not a database call.
      code: `${typedDeclarations} async function f() { for (const row of rows) { await deps.mailer.send(row); } }`,
      filename: typedFixture,
    },
  ],
  invalid: [
    {
      code: `${typedDeclarations} async function f() { for (const row of rows) { await deps.eventStandings.upsert(row); } }`,
      filename: typedFixture,
      errors: [{ messageId: 'queryInLoop' }],
    },
    {
      // A dependency slot declared as `Pick<…Repository, …>`, and one wrapped twice.
      code: `${typedDeclarations} async function f() { for (const row of rows) { await deps.squads.findById(row.id); await deps.partial.findById?.(row.id); } }`,
      filename: typedFixture,
      errors: [{ messageId: 'queryInLoop' }, { messageId: 'queryInLoop' }],
    },
    {
      // An intersection of slots: any member typed as a repository is enough.
      code: `${typedDeclarations} async function f() { await Promise.all(rows.map((row) => deps.predictions.save(row))); }`,
      filename: typedFixture,
      errors: [{ messageId: 'queryInLoop' }],
    },
    {
      // Raw SQL on a client reached under another name, as a tagged template and as a call.
      code: `${typedDeclarations} async function f() { for (const row of rows) { await deps.db.$queryRaw\`SELECT \${row.id}\`; await deps.db.$executeRawUnsafe(row.id); } }`,
      filename: typedFixture,
      errors: [{ messageId: 'queryInLoop' }, { messageId: 'queryInLoop' }],
    },
    {
      // A Prisma model delegate under another name, recognised by its `…Delegate` type.
      code: `${typedDeclarations} async function f() { await Promise.all(rows.map((row) => deps.store.contest.update({ where: { id: row.id } }))); }`,
      filename: typedFixture,
      errors: [{ messageId: 'queryInLoop' }],
    },
  ],
});

ruleTester.run('no-list-lookup', noListLookup, {
  valid: [
    // The single-item read the message asks for.
    'function C({ id }) { const leagueQuery = useLeagueQuery(id); return leagueQuery.data?.name; }',
    // Rendering the whole list is what a list query is for.
    'function C() { const q = useLeaguesQuery(); return (q.data ?? []).map((league) => league.name); }',
    // An emptiness check is not a count on screen.
    'function C() { const q = useLeaguesQuery(); return q.data?.length === 0 ? null : 1; }',
    // A filter on something other than id, status, year, team or user.
    'function C() { const q = useLeaguesQuery(); return (q.data ?? []).filter((league) => league.name.startsWith("A")); }',
    // An ordinary array, not a query result.
    'function C({ rows }) { const one = rows.find((row) => row.id === 1); return `${rows.length}`; }',
    'function C() { const data = loadRows(); return data.find((row) => row.id === 1); }',
    // A hook that is not a query (a mutation) has no list data.
    'function C() { const m = useSaveMutation(); return m.data?.find((row) => row.id === 1); }',
    // `.some` on anything but a known field is not a lookup.
    'function C() { const q = useLeaguesQuery(); return q.data?.some((league) => league.name === "A"); }',
    // A property that only ends in "count" letters is not a count: `accountId`, `discount`.
    'function C() { const q = useLeaguesQuery(); return [{ accountId: q.data?.length }, { discount: q.data?.length }]; }',
    // The escape hatch with a reason, as a line comment or a JSX block comment.
    `function C({ id }) {
      const q = useEventsQuery();
      // poolmaster-allow-list-lookup: the selected row of the list on screen
      const selected = q.data?.find((event) => event.id === id);
      return selected;
    }`,
    `function C() {
      const q = useResultsQuery();
      return (
        <div>
          {/* poolmaster-allow-list-lookup: counts the results listed right below it */}
          {q.data ? <Chip>{q.data.length}</Chip> : null}
        </div>
      );
    }`,
  ],
  invalid: [
    {
      code: 'function C({ id }) { const q = useLeaguesQuery(); return q.data?.find((league) => league.id === id); }',
      errors: [{ messageId: 'lookupInList' }],
    },
    {
      code: 'function C({ id }) { const { data } = useLeaguesQuery(); return data?.findIndex((league) => league.id === id); }',
      errors: [{ messageId: 'lookupInList' }],
    },
    {
      // Destructured with a default, and the data read straight off the hook call.
      code: 'function C({ id }) { const { data: leagues = [] } = useSportLeaguesQuery(); return [leagues.find((l) => l.id === id), useSportLeaguesQuery().data?.find((l) => l.id === id)]; }',
      errors: [{ messageId: 'lookupInList' }, { messageId: 'lookupInList' }],
    },
    {
      // A list envelope one property down, and an alias carrying the list on.
      code: 'function C({ id }) { const q = useLeaguesQuery(); const leagues = q.data?.leagues ?? []; return [q.data?.leagues.find((l) => l.id === id), leagues.find((l) => l.id === id)]; }',
      errors: [{ messageId: 'lookupInList' }, { messageId: 'lookupInList' }],
    },
    {
      code: 'function C({ me }) { const q = useEntriesQuery(); return q.data?.filter((entry) => entry.userId === me).length; }',
      errors: [{ messageId: 'countInBrowser' }],
    },
    {
      // A count on screen: in JSX, in a template literal, or as a count property.
      code: 'function C() { const q = useEntriesQuery(); return [<b>{q.data?.length}</b>, `Entries (${q.data?.length})`, { entryCount: q.data?.length }]; }',
      errors: [{ messageId: 'countInBrowser' }, { messageId: 'countInBrowser' }, { messageId: 'countInBrowser' }],
    },
    {
      code: 'function C() { const q = useContestsQuery(); return (q.data ?? []).filter((contest) => contest.status === ContestStatus.OPEN); }',
      errors: [{ messageId: 'filterInBrowser' }],
    },
    {
      code: 'function C({ year }) { const q = useEventsQuery(); return (q.data ?? []).filter((event) => event.eventYear === year); }',
      errors: [{ messageId: 'filterInBrowser' }],
    },
    {
      code: 'function C({ team }) { const q = useInvitationsQuery(); return (q.data ?? []).filter((invitation) => invitation.squadId === team.id); }',
      errors: [{ messageId: 'filterInBrowser' }],
    },
    {
      // `.some` with an id compare is a lookup of one row.
      code: 'function C({ id }) { const q = useLeaguesQuery(); return q.data?.some((league) => league.id === id); }',
      errors: [{ messageId: 'lookupInList' }],
    },
    {
      // The repo's usual alias: a list memoised off the query data, with or without a block body.
      code: `function C({ id }) {
        const q = useFieldQuery();
        const rows = useMemo(() => q.data ?? [], [q.data]);
        const field = React.useMemo(() => { return q.data?.participants ?? []; }, [q.data]);
        return [rows.find((row) => row.id === id), field.filter((entry) => entry.status === 'ACTIVE').length];
      }`,
      errors: [{ messageId: 'lookupInList' }, { messageId: 'countInBrowser' }],
    },
    {
      // A count property by its name, `count` or `total` (`entryCount` is above).
      code: 'function C() { const q = useEntriesQuery(); return { count: q.data?.length, total: q.data?.length }; }',
      errors: [{ messageId: 'countInBrowser' }, { messageId: 'countInBrowser' }],
    },
    {
      // A marker name with more after it is another word, not a marker: the lookup stays flagged.
      code: `function C({ id }) {
        const q = useLeaguesQuery();
        // poolmaster-allow-list-lookup-foo: not a marker
        return q.data?.find((league) => league.id === id);
      }`,
      errors: [{ messageId: 'lookupInList' }],
    },
    {
      // A marker without the colon has no reason.
      code: `function C({ id }) {
        const q = useLeaguesQuery();
        // poolmaster-allow-list-lookup the list on screen
        return q.data?.find((league) => league.id === id);
      }`,
      errors: [{ messageId: 'missingReason' }],
    },
    {
      // A marker without a reason is an error of its own.
      code: `function C({ id }) {
        const q = useLeaguesQuery();
        // poolmaster-allow-list-lookup:
        return q.data?.find((league) => league.id === id);
      }`,
      errors: [{ messageId: 'missingReason' }],
    },
    {
      // A marker that covers nothing must go: a fix removes its own comment.
      code: `function C({ id }) {
        const q = useLeagueQuery(id);
        // poolmaster-allow-list-lookup: #1251
        return q.data?.name;
      }`,
      errors: [{ messageId: 'unusedAllow' }],
    },
  ],
});

typedRuleTester.run('no-list-lookup (typed)', noListLookup, {
  valid: [
    {
      // An array inside a detail response came with the screen's own read: not a list query.
      code: `
        declare function useContestQuery(): { data?: { id: string; name: string; events: Array<{ id: string }> } };
        function c(id: string) { const q = useContestQuery(); return q.data?.events.find((event) => event.id === id); }`,
      filename: typedFixture,
    },
    {
      // Query data that is not an array.
      code: `
        declare function useSummaryQuery(): { data?: { total: number; label: string } };
        function c() { const q = useSummaryQuery(); return \`\${q.data?.label.length}\`; }`,
      filename: typedFixture,
    },
  ],
  invalid: [
    {
      code: `
        declare function useLeaguesQuery(): { data?: Array<{ id: string }> };
        function c(id: string) { const q = useLeaguesQuery(); return q.data?.find((league) => league.id === id); }`,
      filename: typedFixture,
      errors: [{ messageId: 'lookupInList' }],
    },
    {
      // An intersection with an array part is still a list.
      code: `
        declare function useLeaguesQuery(): { data?: Array<{ id: string }> & { fetchedAt: string } };
        function c(id: string) { const q = useLeaguesQuery(); return q.data?.find((league) => league.id === id); }`,
      filename: typedFixture,
      errors: [{ messageId: 'lookupInList' }],
    },
    {
      // A typed envelope list carried through useMemo, looked up with `.some`.
      code: `
        declare function useMemo<T>(factory: () => T, deps: unknown[]): T;
        declare function useLeaguesQuery(): { data?: { leagues: ReadonlyArray<{ id: string }> } };
        function c(id: string) { const q = useLeaguesQuery(); const leagues = useMemo(() => q.data?.leagues ?? [], [q.data]); return leagues.some((league) => league.id === id); }`,
      filename: typedFixture,
      errors: [{ messageId: 'lookupInList' }],
    },
    {
      // The one array in a list envelope.
      code: `
        declare function useLeaguesQuery(): { data?: { leagues: Array<{ id: string }> } };
        function c(id: string) { const q = useLeaguesQuery(); const leagues = q.data?.leagues ?? []; return leagues.find((league) => league.id === id); }`,
      filename: typedFixture,
      errors: [{ messageId: 'lookupInList' }],
    },
  ],
});

// Last, so the Jest wrapper's check of this line means every suite above ran.
console.log('Local ESLint rule tests passed.');
