/**
 * The four more-info patterns (rules/ux-rules.md §15 *Showing More*): extra information is a
 * HelpTip (?), a DetailsPeek (i), an ExpandableRow or a Notice, all from features/shared/ui.
 *
 * Feature code therefore never:
 * - uses `InfoPopover`, the internal base the HelpTip and DetailsPeek are built on, since a page
 *   that reaches for it picks its own icon and callout and the four patterns drift apart; or
 * - sets a native `title=` tooltip on a DOM element, which shows only to a mouse that rests on
 *   it (no tap, no keyboard) and in the browser's own style.
 *
 * Component props named `title` (a SectionCard's title, a Notice's title) are not tooltips and
 * are left alone: only lowercase, intrinsic elements are checked.
 */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Show extra information with HelpTip, DetailsPeek, ExpandableRow or Notice, not InfoPopover or a title= tooltip.',
    },
    schema: [],
    messages: {
      infoPopover:
        'InfoPopover is internal to features/shared/ui. Use HelpTip (how it works) or DetailsPeek (about one thing).',
      titleTooltip:
        'No native title= tooltips: they never open by tap or keyboard. Use HelpTip or DetailsPeek, or show the text.',
    },
  },
  create(context) {
    return {
      ImportSpecifier(node) {
        if (node.imported.type === 'Identifier' && node.imported.name === 'InfoPopover') {
          context.report({ node, messageId: 'infoPopover' });
        }
      },
      JSXAttribute(node) {
        const element = node.parent;
        if (
          node.name.type === 'JSXIdentifier' &&
          node.name.name === 'title' &&
          element.name.type === 'JSXIdentifier' &&
          /^[a-z]/.test(element.name.name)
        ) {
          context.report({ node, messageId: 'titleTooltip' });
        }
      },
    };
  },
};
