/**
 * #1615. A `Button`, `LinkButton` or `MenuItem` takes its look from its props (`variant`, `size`,
 * `layout`); its `className` places it and nothing else: margin, width, flex or grid placement,
 * visibility. A class that sets its size, padding, corner, colour, border or type restyles one
 * button on one page, and that is how buttons drifted apart. A look the props don't offer gets a
 * variant in `shared/ui/button.tsx`. rules/react-ui-rules.md *Component Gallery and Pattern
 * Catalog* lists the check.
 *
 * Reads the string literals and template-literal chunks inside the `className` attribute only,
 * including those passed through `cn(...)` or a conditional, and every responsive or state prefix
 * (`max-sm:h-10`, `hover:bg-muted`). `normal-case` and `tracking-normal` are
 * `poolmaster/no-button-row-override`'s, so this rule leaves them to it.
 */
const BUTTON_COMPONENTS = new Set(['Button', 'LinkButton', 'MenuItem']);

/** Classes that style a button rather than place it. */
const STYLE_CLASS = new RegExp(
  String.raw`(?<![\w-])(?:[\w-]+:)*-?(?:`
  + [
    String.raw`(?:min-|max-)?h-[\w./\[\]-]+`,
    String.raw`size-[\w./\[\]-]+`,
    String.raw`p[xytrbl]?-[\w./\[\]-]+`,
    String.raw`rounded(?:-[\w./\[\]-]+)?`,
    String.raw`text-[\w./\[\]-]+`,
    String.raw`font-[\w-]+`,
    String.raw`bg-[\w./\[\]-]+`,
    String.raw`border(?:-[\w./\[\]-]+)?`,
    String.raw`shadow(?:-[\w./\[\]-]+)?`,
    String.raw`leading-[\w./\[\]-]+`,
    String.raw`underline`,
    String.raw`uppercase`,
    String.raw`italic`,
    String.raw`tabular-nums`,
  ].join('|')
  + String.raw`)(?![\w-])`,
  'g',
);

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'A Button, LinkButton or MenuItem className only places it (margin, width, flex placement); its look comes from variant, size and layout.',
    },
    schema: [],
    messages: {
      styleOverride:
        '"{{matches}}" restyles {{component}} — its className only places it (margin, width, flex placement). Use variant, size or layout, or add a variant in shared/ui/button.tsx.',
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
            const matches = text.match(STYLE_CLASS);
            if (matches) {
              context.report({
                node,
                messageId: 'styleOverride',
                data: { component: element.name.name, matches: matches.join(' ') },
              });
            }
          }
        }
      },
    };
  },
};
