import { useState, useCallback } from 'react';

interface Toast {
  id: string;
  title?: string;
  description?: string;
}

let toastCount = 0;
const listeners: Array<(toasts: Toast[]) => void> = [];
let memoryState: Toast[] = [];

function dispatch(toast: Toast) {
  memoryState = [...memoryState, toast];
  listeners.forEach((listener) => listener(memoryState));
  setTimeout(() => {
    memoryState = memoryState.filter((t) => t.id !== toast.id);
    listeners.forEach((listener) => listener(memoryState));
  }, 5000);
}

export function toast({ title, description }: Omit<Toast, 'id'>) {
  dispatch({ id: String(++toastCount), title, description });
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>(memoryState);

  useState(() => {
    listeners.push(setToasts);
    return () => {
      const index = listeners.indexOf(setToasts);
      if (index > -1) listeners.splice(index, 1);
    };
  });

  return {
    toasts,
    toast: useCallback(
      (props: Omit<Toast, 'id'>) => toast(props),
      [],
    ),
  };
}
