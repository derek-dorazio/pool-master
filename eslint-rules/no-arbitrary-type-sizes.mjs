/**
 * #1144. Feature code takes letter spacing and text size from the theme, so a type change lands
 * everywhere at once. A hand-typed `tracking-[0.2em]` or `text-[11px]` opts that one element out
 * silently. Use the theme's spacing names (`tracking-eyebrow`, `tracking-label`), Tailwind's
 * size steps (`text-xs`), or a shared UI primitive such as `Eyebrow`.
 *
 * Like `no-raw-theme-colors`, it reads string literals, template-literal chunks and JSX text from
 * the AST, so a comment never matches. `text-[…]` is reported only with a length inside the
 * brackets; `text-[color:var(--x)]` is a colour, not a size.
 */
const ARBITRARY_TYPE_SIZE = /(?<![\w-])(?:[\w-]+:)*(?:tracking-\[[^\]\s]+\]|text-\[\d*\.?\d+(?:px|rem|em)\])/g;

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Feature code uses the theme letter spacing and text sizes, not hand-typed tracking-[…] or text-[Npx].',
    },
    schema: [],
    messages: {
      arbitraryTypeSize:
        'Hand-typed type size "{{matches}}" in feature code — use a theme letter spacing (tracking-eyebrow, tracking-label), a text size step, or Eyebrow.',
    },
  },
  create(context) {
    function check(node, text) {
      const matches = text.match(ARBITRARY_TYPE_SIZE);
      if (matches) {
        context.report({ node, messageId: 'arbitraryTypeSize', data: { matches: matches.join(', ') } });
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
