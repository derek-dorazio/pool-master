/**
 * #1273. A `Button` or `LinkButton` drawn as a row (a list line, a menu entry, a card toggle) takes
 * `layout="row"`, and a dropdown entry is a `MenuItem`. Hand-typing `normal-case` or
 * `tracking-normal` into its `className` rebuilds that look one page at a time, which is how about
 * twenty slightly different rows came about.
 *
 * Reads the string literals and template-literal chunks inside the `className` attribute only,
 * including those passed through `cn(...)` or a conditional, so the same classes on a `<span>` or in
 * a comment never match. A class string built in a variable elsewhere is out of its reach.
 */
const BUTTON_COMPONENTS = new Set(['Button', 'LinkButton', 'MenuItem']);
const ROW_OVERRIDE = /(?<![\w-])(?:[\w-]+:)*(?:normal-case|tracking-normal)(?![\w-])/g;

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'A Button drawn as a row uses layout="row" or MenuItem, not a hand-typed normal-case tracking-normal.',
    },
    schema: [],
    messages: {
      rowOverride:
        'Hand-typed "{{matches}}" on {{component}} — use layout="row" (or MenuItem for a dropdown entry) instead.',
    },
  },
  create(context) {
    function strings(node, found) {
      if (!node || typeof node !== 'object') return found;
      if (node.type === 'Literal' && typeof node.value === 'string') {
        found.push([node, node.value]);
      } else if (node.type === 'TemplateElement') {
        found.push([node, node.value.raw]);
      } else {
        for (const [key, value] of Object.entries(node)) {
          if (key === 'parent' || key === 'loc' || key === 'range') continue;
          if (Array.isArray(value)) value.forEach((child) => strings(child, found));
          else if (value && typeof value.type === 'string') strings(value, found);
        }
      }
      return found;
    }

    return {
      JSXOpeningElement(element) {
        if (element.name.type !== 'JSXIdentifier' || !BUTTON_COMPONENTS.has(element.name.name)) return;
        for (const attribute of element.attributes) {
          if (attribute.type !== 'JSXAttribute' || attribute.name.name !== 'className') continue;
          for (const [node, text] of strings(attribute.value, [])) {
            const matches = text.match(ROW_OVERRIDE);
            if (matches) {
              context.report({
                node,
                messageId: 'rowOverride',
                data: { component: element.name.name, matches: matches.join(' ') },
              });
            }
          }
        }
      },
    };
  },
};
