/**
 * #1599. Feature code opens one of the four shared dialog types, never the raw `Modal`:
 * `FormModal` to edit something, `ConfirmDialog` for yes/no (danger toned when destructive),
 * `PickerModal` to choose from a list, and `ReadOnlyDetailModal` to look only. Each owns its
 * buttons, its pending state and where a failure shows, so a hand-built dialog is how five
 * slightly different footers and success boxes came about. rules/ux-rules.md §3 *Dialogs and
 * save feedback*.
 *
 * Follows the import, not the name: `Modal` imported under any local name from the shared UI
 * (or its `modal` module), and Radix's dialog parts used directly (`Dialog.Root`, or `Root`
 * or its alias `Dialog` imported from `@radix-ui/react-dialog`) are all caught.
 */
const SHARED_UI_SOURCE = /(?:^|\/)shared\/ui(?:\/modal)?$|^\.\/modal$/;
const RADIX_DIALOG_SOURCE = '@radix-ui/react-dialog';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Feature dialogs use FormModal, ConfirmDialog, PickerModal or ReadOnlyDetailModal, not the raw Modal.',
    },
    schema: [],
    messages: {
      rawModal:
        'Raw dialog in feature code — use FormModal (edit), ConfirmDialog (yes/no), PickerModal (choose) or ReadOnlyDetailModal (look only).',
    },
  },
  create(context) {
    // Local names bound to the shared Modal, to Radix's dialog namespace, and to Radix's Root.
    const modalNames = new Set();
    const radixNamespaces = new Set();
    const radixRoots = new Set();

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== 'string') return;
        if (SHARED_UI_SOURCE.test(source)) {
          for (const specifier of node.specifiers) {
            if (specifier.type === 'ImportSpecifier' && specifier.imported.name === 'Modal') {
              modalNames.add(specifier.local.name);
            }
          }
        } else if (source === RADIX_DIALOG_SOURCE) {
          for (const specifier of node.specifiers) {
            if (specifier.type === 'ImportNamespaceSpecifier' || specifier.type === 'ImportDefaultSpecifier') {
              radixNamespaces.add(specifier.local.name);
            } else if (specifier.type === 'ImportSpecifier' && (specifier.imported.name === 'Root' || specifier.imported.name === 'Dialog')) {
              radixRoots.add(specifier.local.name);
            }
          }
        }
      },
      JSXOpeningElement(element) {
        const { name } = element;
        const isRaw =
          (name.type === 'JSXIdentifier' && (modalNames.has(name.name) || radixRoots.has(name.name)))
          || (name.type === 'JSXMemberExpression'
            && name.object.type === 'JSXIdentifier'
            && radixNamespaces.has(name.object.name)
            && name.property.name === 'Root');
        if (isRaw) {
          context.report({ node: element, messageId: 'rawModal' });
        }
      },
    };
  },
};
