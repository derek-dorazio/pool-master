/**
 * #1697. `Tile` has two corners (#1638): `sm`, the one 8px content corner, and `panel`, 16px, for
 * a panel that stands apart from the content. Only the panels named in rules/ux-rules.md §12
 * item 13 *One section look* may ask for `panel`, and eslint.config.js lists their files as this
 * rule's ignores. A new panel adds its file there and to that item in the same PR.
 *
 * Reports a `radius` prop that is or can be the string "panel" on any element: `radius="panel"`,
 * `radius={'panel'}`, or a ternary or `&&`/`||` with a "panel" branch. `Tile` and the shared
 * parts that pass a radius on (`TabbedCard`) are both covered. A radius passed through from a
 * prop (`radius={radius}`) is the caller's choice and is checked where the caller writes it. It
 * cannot see "panel" held in a variable first (`const corner = 'panel'`); review catches that.
 */
/** Whether an expression is, or can be, the string "panel": a literal, or either branch of a ternary or `&&`/`||`. */
function mayBePanel(expression) {
  switch (expression.type) {
    case 'Literal':
      return expression.value === 'panel';
    case 'TemplateLiteral':
      return expression.expressions.length === 0 && expression.quasis[0]?.value.cooked === 'panel';
    case 'ConditionalExpression':
      return mayBePanel(expression.consequent) || mayBePanel(expression.alternate);
    case 'LogicalExpression':
      return mayBePanel(expression.left) || mayBePanel(expression.right);
    default:
      return false;
  }
}

function isPanel(value) {
  if (!value) return false;
  if (value.type === 'Literal') return value.value === 'panel';
  return value.type === 'JSXExpressionContainer' && mayBePanel(value.expression);
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
