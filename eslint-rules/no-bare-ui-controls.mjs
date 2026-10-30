/**
 * Replaces scripts/check-shared-ui-controls.mjs.
 *
 * Feature code uses the shared primitives in features/shared/ui so that focus
 * handling, disabled semantics, sizing and theme tokens stay consistent. A bare
 * `<button>` looks fine in isolation and diverges everywhere it matters.
 *
 * Strictly more precise than the scanner, which was a raw-text regex and so
 * flagged `<button>` inside comments and strings. The opposite direction from
 * slice 1's `typeof fetch` case, where the ported rule was less precise.
 *
 * A bare `<table>` is the same problem at a larger size: each one picked its own
 * header fill, padding and row rules, so feature code builds tables from
 * `SimpleTable` (or `DataGrid` when it needs search and sorting).
 */
const BARE_CONTROLS = new Set(['button', 'input', 'textarea']);

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Use a shared UI primitive rather than a bare button, input, textarea or table.',
    },
    schema: [],
    messages: {
      bareControl:
        'Use the shared UI {{control}} primitive, or add/extend one in features/shared/ui.',
      bareTable:
        'Build the table from SimpleTable and its parts (or DataGrid for search and sorting), or extend them in features/shared/ui.',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier') return;
        if (node.name.name === 'table') {
          context.report({ node: node.name, messageId: 'bareTable' });
          return;
        }
        if (!BARE_CONTROLS.has(node.name.name)) return;
        context.report({
          node: node.name,
          messageId: 'bareControl',
          data: { control: node.name.name },
        });
      },
    };
  },
};
