/**
 * Replaces scripts/check-no-duplicate-extract-error-message.mjs.
 *
 * The canonical `extractErrorMessage` in lib/errors.ts supports a per-feature
 * `codeMessages` map and a configurable fallback. Local copies drifted -- different
 * fallback strings, no codeMessages support -- so the same backend error read
 * differently on different screens.
 *
 * Only fresh DEFINITIONS are flagged. Importing the canonical one, or wrapping a
 * call to it, is the intended usage and is not a finding. The plan originally
 * paired this with `no-restricted-imports`; that half is inapplicable, because the
 * violation is a local definition and there is no non-canonical module to ban
 * importing from.
 */
const NAME = 'extractErrorMessage';

function isFunctionLike(node) {
  return (
    node &&
    (node.type === 'ArrowFunctionExpression' ||
      node.type === 'FunctionExpression')
  );
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Import extractErrorMessage from lib/errors rather than defining another one.',
    },
    schema: [],
    messages: {
      duplicateExtractor:
        'Local {{name}} definition — import it from @/lib/errors instead, and pass { fallback, codeMessages? }.',
    },
  },
  create(context) {
    return {
      FunctionDeclaration(node) {
        if (node.id && node.id.name === NAME) {
          context.report({
            node: node.id,
            messageId: 'duplicateExtractor',
            data: { name: NAME },
          });
        }
      },
      VariableDeclarator(node) {
        if (
          node.id.type === 'Identifier' &&
          node.id.name === NAME &&
          isFunctionLike(node.init)
        ) {
          context.report({
            node: node.id,
            messageId: 'duplicateExtractor',
            data: { name: NAME },
          });
        }
      },
    };
  },
};
