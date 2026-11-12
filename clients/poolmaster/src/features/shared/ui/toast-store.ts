import type { ReactNode } from "react";

/** What a toast says: a short title ("Profile saved"), and rarely one more line. */
export type ToastMessage = {
  description?: ReactNode;
  title: ReactNode;
  tone?: "default" | "danger" | "success";
};

export type ShownToast = ToastMessage & { id: number };

let shown: readonly ShownToast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function publish(next: readonly ShownToast[]) {
  shown = next;
  for (const listener of listeners) {
    listener();
  }
}

/** For `Toaster`: re-render when the list changes. */
export function subscribeToToasts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getShownToasts(): readonly ShownToast[] {
  return shown;
}

/**
 * Shows a toast in the app's one `Toaster`. It lives outside any component, so it outlives the
 * dialog a save closes and the page a leave navigates away from.
 */
export function showToast(toast: ToastMessage) {
  const id = nextId;
  nextId += 1;
  publish([...shown, { ...toast, id }]);
  return id;
}

export function dismissToast(id: number) {
  publish(shown.filter((toast) => toast.id !== id));
}

/** Empties the store: every toast goes at once. */
export function dismissAllToasts() {
  publish([]);
}
