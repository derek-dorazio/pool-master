/**
 * #1697. `Tile` has two corners (#1638): `sm`, the one 8px content corner, and `panel`, 16px, for
 * a panel that stands apart from the content. Only the panels named in rules/ux-rules.md §12
 * item 13 *One section look* may ask for `panel`, and eslint.config.js lists their files as this
 * rule's ignores. A new panel adds its file there and to that item in the same PR.
 *
 * Reports a `radius` prop set to the string "panel" on any element, written as `radius="panel"`
 * or `radius={'panel'}`, so `Tile` and the shared parts that pass a radius on (`TabbedCard`) are
 * both covered. A radius passed through from a prop (`radius={radius}`) is the caller's choice
 * and is checked where the caller writes it.
 */
function isPanel(value) {
  if (!value) return false;
  if (value.type === 'Literal') return value.value === 'panel';
  if (value.type === 'JSXExpressionContainer') {
    const { expression } = value;
    return (expression.type === 'Literal' && expression.value === 'panel')
      || (expression.type === 'TemplateLiteral' && expression.expressions.length === 0 && expression.quasis[0]?.value.cooked === 'panel');
  }
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Only the named panels use the panel corner (radius="panel"); every other box keeps the 8px content corner.',
    },
    schema: [],
    messages: {
      panelCorner:
        'radius="panel" is only for the panels named in rules/ux-rules.md §12 item 13 (One section look). A content box keeps the default 8px corner. A new panel adds its file to that item and to this rule\'s ignores in eslint.config.js in the same PR.',
    },
  },
  create(context) {
    return {
      JSXAttribute(attribute) {
        if (attribute.name.type === 'JSXIdentifier' && attribute.name.name === 'radius' && isPanel(attribute.value)) {
          context.report({ node: attribute, messageId: 'panelCorner' });
        }
      },
    };
  },
};
