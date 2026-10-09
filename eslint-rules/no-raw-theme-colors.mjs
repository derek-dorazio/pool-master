/**
 * Replaces scripts/check-feature-theme-tokens.mjs (#207, #524).
 *
 * Feature code takes colour from semantic theme tokens and the shared UI primitives, so a
 * theme change lands everywhere at once. A raw Tailwind colour-scale class
 * (`bg-red-500`, `text-slate-700/80`) or a literal colour (`#1a2b3c`, `rgb(`) opts that
 * one element out silently.
 *
 * The scanner was a line-based regex pass over the source with comments blanked out. This
 * rule applies the same two patterns to the same text, but reads it from the AST: string
 * literals, template-literal chunks and JSX text. So a comment such as "see #206" is never
 * a colour -- the false positive that cost #192 and #206 a lint round each -- without a
 * hand-rolled comment stripper.
 *
 * CSS. The scanner also walked `.css` files under features/. There are none, and ESLint
 * cannot read CSS without `@eslint/css`, which is not installed. Theme CSS lives in the
 * theme layer (`rules/react-ui-rules.md`), so a stylesheet under features/ is itself
 * the drift; adding the CSS language plugin for a file type the feature tree does not
 * have was judged not worth a dependency.
 *
 * Complementary to `no-inline-theme-styles`, which checks literal values on theme-bearing
 * `style` props. This one checks class strings and colour literals wherever they appear.
 */
const RAW_TAILWIND_COLOR =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke|accent|decoration)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}(?:\/\d+)?\b/g;
const RAW_COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/g;

function rawColors(text) {
  return [...(text.match(RAW_TAILWIND_COLOR) ?? []), ...(text.match(RAW_COLOR_LITERAL) ?? [])];
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Feature code uses semantic theme tokens, not raw Tailwind colour-scale classes or literal colours.',
    },
    schema: [],
    messages: {
      rawThemeColor:
        'Raw colour "{{matches}}" in feature code — use a semantic theme token or a shared UI primitive.',
    },
  },
  create(context) {
    function check(node, text) {
      const matches = rawColors(text);
      if (matches.length > 0) {
        context.report({ node, messageId: 'rawThemeColor', data: { matches: matches.join(', ') } });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
      JSXText(node) {
        check(node, node.value);
      },
    };
  },
};
