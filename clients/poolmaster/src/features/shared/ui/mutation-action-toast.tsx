/**
 * The toast `useMutationActionWorkflow` drives, split out so that
 * `mutation-action-workflow.ts` exports only the hook and its types.
 *
 * Split for `react-refresh/only-export-components` (#345 Phase 0, from #167):
 * the hook and this component shared a module, so editing the component forced a
 * full page reload instead of a hot update. The type is imported under an alias
 * because it and this component deliberately share the name `MutationActionToast`
 * across the type and value namespaces.
 */
import { Toast, ToastProvider, ToastViewport } from "./toast";
import type { MutationActionToast as MutationActionToastState } from "./mutation-action-workflow";

export function MutationActionToast({
  onDismiss,
  toast,
}: {
  onDismiss: () => void;
  toast: MutationActionToastState | null;
}) {
  if (!toast) {
    return null;
  }

  return (
    <ToastProvider>
      <Toast
        description={toast.description}
        onOpenChange={(open) => {
          if (!open) {
            onDismiss();
          }
        }}
        open
        title={toast.title}
        tone={toast.tone}
      />
      <ToastViewport />
    </ToastProvider>
  );
}
