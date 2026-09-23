/**
 * Replaces scripts/check-no-mocked-api.mjs.
 *
 * Module-mocking the generated API boundary replaces the contract under test
 * with whatever the test author imagined it to be, which is how a test keeps
 * passing after the real contract changes. MSW intercepts at the network layer
 * instead, so the generated client stays in the path.
 *
 * Widened beyond the scanner on purpose: the scanner matched `vi.mock` only,
 * and the backend runs Jest. `jest.mock('@/lib/api')` was previously invisible.
 */
const RUNNERS = new Set(['vi', 'jest']);
const BANNED_MODULES = new Set(['@/lib/api', '@/lib/api-client']);

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Do not module-mock the generated API boundary; use MSW or lower-level fixtures.',
    },
    schema: [],
    messages: {
      mockedApi:
        'Do not module-mock the generated API boundary ({{module}}); use MSW or lower-level test fixtures.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node;
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.object.type !== 'Identifier' ||
          !RUNNERS.has(callee.object.name) ||
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'mock'
        ) {
          return;
        }

        const [first] = node.arguments;
        if (
          first &&
          first.type === 'Literal' &&
          typeof first.value === 'string' &&
          BANNED_MODULES.has(first.value)
        ) {
          context.report({
            node,
            messageId: 'mockedApi',
            data: { module: first.value },
          });
        }
      },
    };
  },
};
