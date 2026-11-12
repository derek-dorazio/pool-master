import { useSyncExternalStore } from "react";
import { Toast, ToastProvider, ToastViewport } from "./toast";
import { dismissToast, getShownToasts, subscribeToToasts } from "./toast-store";

/**
 * The app's toasts, bottom right, each closing itself after a few seconds. Mounted once at the
 * app root; anything calls `showToast` (or a `useMutationActionWorkflow` success toast).
 */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToToasts, getShownToasts, getShownToasts);
  return (
    <ToastProvider>
      {toasts.map((toast) => (
        <Toast
          data-testid="app-toast"
          description={toast.description}
          key={toast.id}
          onOpenChange={(open) => {
            if (!open) {
              dismissToast(toast.id);
            }
          }}
          open
          title={toast.title}
          tone={toast.tone}
        />
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
