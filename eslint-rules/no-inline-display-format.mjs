/**
 * #1587: the web app writes places, points, counts, money and dates through one module,
 * `features/shared/ui/format.ts` (dates through `date-time-format.ts`, which it re-exports).
 * Before it, the same value was formatted several ways: three ordinal helpers, points pinned to
 * en-US in one place and unformatted in another, and plan limits hard-coding
 * `toLocaleString('en-US')` while dates followed the viewer's locale.
 *
 * Flagged in feature code, so a new one goes through the shared module and its locale:
 * - `x.toLocaleString(...)`, `x.toLocaleDateString(...)`, `x.toLocaleTimeString(...)`
 * - `x.toFixed(...)` and `x.toPrecision(...)`
 * - `new Intl.NumberFormat(...)`, `new Intl.DateTimeFormat(...)`, `new Intl.PluralRules(...)`,
 *   `new Intl.RelativeTimeFormat(...)` and `new Intl.ListFormat(...)`, with or without `new`
 *
 * Reading the browser's own settings (`Intl.DateTimeFormat().resolvedOptions()`) is not
 * formatting; it lives in the shared time zone helpers, which the config leaves out.
 */
const METHODS = new Set(['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'toFixed', 'toPrecision']);
const INTL_FORMATS = new Set(['NumberFormat', 'DateTimeFormat', 'PluralRules', 'RelativeTimeFormat', 'ListFormat']);

function intlFormatName(callee) {
  return callee.type === 'MemberExpression'
    && !callee.computed
    && callee.object.type === 'Identifier'
    && callee.object.name === 'Intl'
    && callee.property.type === 'Identifier'
    && INTL_FORMATS.has(callee.property.name)
    ? callee.property.name
    : null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Format values on screen through features/shared/ui/format.ts, in the viewer\'s locale.',
    },
    schema: [],
    messages: {
      inlineMethod:
        '.{{name}}() formats a value inline. Use the shared formatters in @/features/shared/ui (format.ts) with the viewer\'s locale.',
      inlineIntl:
        'Intl.{{name}} formats a value inline. Use the shared formatters in @/features/shared/ui (format.ts) with the viewer\'s locale.',
    },
  },
  create(context) {
    function checkIntl(node) {
      const name = intlFormatName(node.callee);
      if (name) {
        context.report({ node, messageId: 'inlineIntl', data: { name } });
      }
    }
    return {
      NewExpression: checkIntl,
      CallExpression(node) {
        checkIntl(node);
        const { callee } = node;
        if (
          callee.type === 'MemberExpression'
          && !callee.computed
          && callee.property.type === 'Identifier'
          && METHODS.has(callee.property.name)
        ) {
          context.report({ node: callee.property, messageId: 'inlineMethod', data: { name: callee.property.name } });
        }
      },
    };
  },
};
