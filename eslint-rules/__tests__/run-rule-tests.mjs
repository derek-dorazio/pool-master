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

import noInlineQueryKeys from '../no-inline-query-keys.mjs';
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

console.log('Local ESLint rule tests passed.');
