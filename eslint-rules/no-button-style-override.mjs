/**
 * #1615. A `Button`, `LinkButton` or `MenuItem` takes its look from its props (`variant`, `size`,
 * `layout`); its `className` places it and nothing else: margin, width, flex or grid placement,
 * visibility. A class that sets its size, padding, corner, colour, border or type restyles one
 * button on one page, and that is how buttons drifted apart. A look the props don't offer gets a
 * variant in `shared/ui/button.tsx`. rules/react-ui-rules.md *Component Gallery and Pattern
 * Catalog* lists the check.
 *
 * Reads the class strings inside the `className` attribute only: literals and template-literal
 * chunks, those passed to `cn(...)` or as its object keys, and the branches of a conditional or
 * `&&`/`||`, but never a comparison's operands or a condition (`tone === 'border' && 'mt-2'`
 * flags nothing). Every responsive or state prefix counts (`max-sm:h-10`, `hover:bg-muted`).
 * `h-full` and `min-h-0` fill or let a flex parent shrink the button, which is placement, so they
 * pass. `normal-case` and `tracking-normal` are `poolmaster/no-button-row-override`'s, so this
 * rule leaves them to it.
 *
 * GRANDFATHERED FILES — the `baseline` option maps a file, from the repo root, to the overrides
 * it may still have (`eslint-rules/button-style-baseline.json`). A file at or under its count
 * passes; one over it reports every override it has, so a listed file cannot add a new one. The
 * counts only go down (`rules:check:baseline-ratchet`), and
 * `scripts/button-style-baseline.test.mjs` fails a count above what the file has now.
 */
import { relative, sep } from 'node:path';

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
    String.raw`lowercase`,
    String.raw`capitalize`,
    String.raw`ring(?:-[\w./\[\]-]+)?`,
    String.raw`outline(?:-[\w./\[\]-]+)?`,
    String.raw`opacity-[\w./\[\]-]+`,
    String.raw`tracking-(?!normal(?![\w-]))[\w./\[\]-]+`,
  ].join('|')
  + String.raw`)(?![\w-])`,
  'g',
);

/** Height classes that fill or shrink with the button's container: placement, not look. */
const PLACEMENT_HEIGHTS = new Set(['h-full', 'min-h-0']);

/** A matched class without its variant prefixes (`md:h-full` is `h-full`). */
function bareClass(match) {
  return match.slice(match.lastIndexOf(':') + 1);
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'A Button, LinkButton or MenuItem className only places it (margin, width, flex placement); its look comes from variant, size and layout.',
    },
    schema: [{
      type: 'object',
      properties: { baseline: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } } },
      additionalProperties: false,
    }],
    messages: {
      styleOverride:
        '"{{matches}}" restyles {{component}} — its className only places it (margin, width, flex placement). Use variant, size or layout, or add a variant in shared/ui/button.tsx.',
      overBaseline:
        '"{{matches}}" restyles {{component}} — this file has {{found}} button overrides and eslint-rules/button-style-baseline.json allows {{allowed}}. Remove the new one: use variant, size or layout, or add a variant in shared/ui/button.tsx.',
    },
  },
  create(context) {
    const baseline = context.options[0]?.baseline ?? {};
    const file = relative(context.cwd, context.filename).split(sep).join('/');
    const allowed = baseline[file] ?? 0;
    const overrides = [];

    /** The class strings an expression can put in `className`, never a condition or comparison. */
    function strings(node, found) {
      if (!node || typeof node !== 'object') return found;
      switch (node.type) {
        case 'Literal':
          if (typeof node.value === 'string') found.push([node, node.value]);
          return found;
        case 'TemplateLiteral':
          node.quasis.forEach((quasi) => found.push([quasi, quasi.value.raw]));
          node.expressions.forEach((expression) => strings(expression, found));
          return found;
        case 'JSXExpressionContainer':
          return strings(node.expression, found);
        case 'ConditionalExpression':
          strings(node.consequent, found);
          return strings(node.alternate, found);
        case 'LogicalExpression':
          // `a && 'cls'` adds only its right side; `a || 'cls'` and `a ?? 'cls'` may add either.
          if (node.operator !== '&&') strings(node.left, found);
          return strings(node.right, found);
        case 'CallExpression':
          node.arguments.forEach((argument) => strings(argument, found));
          return found;
        case 'ArrayExpression':
          node.elements.forEach((element) => strings(element, found));
          return found;
        case 'ObjectExpression':
          // `cn({ 'h-10': isTall })`: the keys are the classes, the values their conditions.
          node.properties.forEach((property) => {
            if (property.type === 'Property') strings(property.computed ? null : property.key, found);
          });
          return found;
        default:
          return found;
      }
    }

    return {
      JSXOpeningElement(element) {
        if (element.name.type !== 'JSXIdentifier' || !BUTTON_COMPONENTS.has(element.name.name)) return;
        for (const attribute of element.attributes) {
          if (attribute.type !== 'JSXAttribute' || attribute.name.name !== 'className') continue;
          for (const [node, text] of strings(attribute.value, [])) {
            const matches = (text.match(STYLE_CLASS) ?? []).filter((match) => !PLACEMENT_HEIGHTS.has(bareClass(match)));
            if (matches.length > 0) overrides.push({ node, data: { component: element.name.name, matches: matches.join(' ') } });
          }
        }
      },
      'Program:exit'() {
        if (overrides.length <= allowed) return;
        for (const { node, data } of overrides) {
          if (allowed === 0) context.report({ node, messageId: 'styleOverride', data });
          else context.report({ node, messageId: 'overBaseline', data: { ...data, found: String(overrides.length), allowed: String(allowed) } });
        }
      },
    };
  },
};
