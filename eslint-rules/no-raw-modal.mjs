/**
 * #1599. Feature code opens one of the four shared dialog types, never the raw `Modal`:
 * `FormModal` to edit something, `ConfirmDialog` for yes/no (danger toned when destructive),
 * `PickerModal` to choose from a list, and `ReadOnlyDetailModal` to look only. Each owns its
 * buttons, its pending state and where a failure shows, so a hand-built dialog is how five
 * slightly different footers and success boxes came about. rules/ux-rules.md §3 *Dialogs and
 * save feedback*.
 */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Feature dialogs use FormModal, ConfirmDialog, PickerModal or ReadOnlyDetailModal, not the raw Modal.',
    },
    schema: [],
    messages: {
      rawModal:
        'Raw <Modal> in feature code — use FormModal (edit), ConfirmDialog (yes/no), PickerModal (choose) or ReadOnlyDetailModal (look only).',
    },
  },
  create(context) {
    return {
      JSXOpeningElement(element) {
        if (element.name.type === 'JSXIdentifier' && element.name.name === 'Modal') {
          context.report({ node: element, messageId: 'rawModal' });
        }
      },
    };
  },
};
