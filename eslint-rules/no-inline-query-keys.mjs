/**
 * Replaces scripts/check-no-inline-query-keys.mjs.
 *
 * TanStack query keys come from the factory in `lib/query-keys.ts` so that a
 * mutation's invalidation and a query's key cannot drift apart. An inline array
 * at a call site is invisible to the factory and to every other call site.
 *
 * Matches the scanner exactly: a `queryKey` property whose value is an array
 * literal, after unwrapping `as const`, `satisfies`, parentheses and the legacy
 * `<T>x` assertion form. The property name may be an identifier or a quoted
 * string -- `{ 'queryKey': [...] }` is the same violation.
 */
const UNWRAPPED = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSTypeAssertion',
  'TSNonNullExpression',
]);

function unwrap(node) {
  let current = node;
  while (current && UNWRAPPED.has(current.type)) {
    current = current.expression;
  }
  return current;
}

function isQueryKeyName(key, computed) {
  if (computed) return false;
  if (key.type === 'Identifier') return key.name === 'queryKey';
  if (key.type === 'Literal') return key.value === 'queryKey';
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Use the QueryKeys factory rather than an inline queryKey array literal.',
    },
    schema: [],
    messages: {
      inlineQueryKey:
        'Inline queryKey array — use QueryKeys from clients/poolmaster/src/lib/query-keys.ts.',
    },
  },
  create(context) {
    return {
      Property(node) {
        if (!isQueryKeyName(node.key, node.computed)) return;
        const value = unwrap(node.value);
        if (value && value.type === 'ArrayExpression') {
          context.report({ node: node.key, messageId: 'inlineQueryKey' });
        }
      },
    };
  },
};
