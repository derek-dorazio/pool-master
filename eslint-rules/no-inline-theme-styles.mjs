/**
 * Replaces scripts/check-no-inline-theme-styles.mjs.
 *
 * Theme-bearing values come from semantic tokens and CSS variables, so a theme
 * change lands everywhere at once. A literal in an inline `style` prop opts that
 * one element out silently.
 *
 * NOTE ON SCOPE -- the plan described this as "raw color literals" and that is
 * wrong. The scanner flags a literal of ANY kind on these fourteen props, so
 * `fontSize: 14` and `color: 'inherit'` are violations too. Implementing the
 * plan's wording would have quietly dropped them. Verified by planting both.
 *
 * A computed value is allowed: `style={{ color: theme.accent }}` is the pattern
 * this rule exists to push people toward.
 */
const THEME_PROPS = new Set([
  'background',
  'backgroundColor',
  'border',
  'borderColor',
  'borderRadius',
  'boxShadow',
  'color',
  'font',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'textShadow',
]);

function propertyName(key, computed) {
  if (computed) return null;
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'Literal') return String(key.value);
  return null;
}

function isLiteralValue(node) {
  if (!node) return false;
  if (node.type === 'Literal') {
    return (
      typeof node.value === 'string' ||
      typeof node.value === 'number' ||
      typeof node.value === 'boolean'
    );
  }
  // A template with no interpolation is still a hardcoded value; the scanner
  // matched these through isStringLiteralLike.
  return node.type === 'TemplateLiteral' && node.expressions.length === 0;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Use semantic theme tokens rather than literal values in inline style props.',
    },
    schema: [],
    messages: {
      inlineThemeStyle:
        'Inline literal on theme-bearing style prop "{{prop}}" — use a semantic theme token or CSS variable.',
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'style') return;
        const value = node.value;
        if (
          !value ||
          value.type !== 'JSXExpressionContainer' ||
          value.expression.type !== 'ObjectExpression'
        ) {
          return;
        }

        for (const property of value.expression.properties) {
          if (property.type !== 'Property') continue;
          const name = propertyName(property.key, property.computed);
          if (!name || !THEME_PROPS.has(name)) continue;
          if (isLiteralValue(property.value)) {
            context.report({
              node: property,
              messageId: 'inlineThemeStyle',
              data: { prop: name },
            });
          }
        }
      },
    };
  },
};
