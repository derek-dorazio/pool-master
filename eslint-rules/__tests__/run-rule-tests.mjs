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
import noDuplicateExtractErrorMessage from '../no-duplicate-extract-error-message.mjs';
import noInlineQueryKeys from '../no-inline-query-keys.mjs';
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
