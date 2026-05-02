import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback, useState, type ReactNode } from "react";
import { Toast, ToastProvider, ToastViewport } from "./toast";

export type MutationActionToast = {
  description?: ReactNode;
  title: ReactNode;
  tone?: "default" | "danger" | "success";
};

type MutationActionToastFactory<TData, TVariables> =
  | MutationActionToast
  | ((data: TData, variables: TVariables) => MutationActionToast | null | undefined);

type MutationActionErrorToastFactory<TVariables> =
  | MutationActionToast
  | ((error: unknown, variables: TVariables) => MutationActionToast | null | undefined);

type MutationActionInvalidate<TData, TVariables> =
  | readonly QueryKey[]
  | ((data: TData, variables: TVariables) => readonly QueryKey[] | Promise<readonly QueryKey[]>);

type MutationActionRun<TVariables, TData> = [TVariables] extends [void]
  ? () => Promise<TData>
  : (variables: TVariables) => Promise<TData>;

export type MutationActionWorkflowOptions<TData, TVariables = void> = {
  action: (variables: TVariables) => Promise<TData>;
  closeOnSuccess?: boolean;
  errorToast?: MutationActionErrorToastFactory<TVariables>;
  invalidateQueries?: MutationActionInvalidate<TData, TVariables>;
  navigate?: (data: TData, variables: TVariables) => void | Promise<void>;
  onClose?: () => void;
  onError?: (error: unknown, variables: TVariables) => void | Promise<void>;
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
  successToast?: MutationActionToastFactory<TData, TVariables>;
};

export type MutationActionWorkflowResult<TData, TVariables = void> = {
  data: TData | null;
  dismissToast: () => void;
  error: unknown;
  isError: boolean;
  isPending: boolean;
  reset: () => void;
  run: MutationActionRun<TVariables, TData>;
  toast: MutationActionToast | null;
};

function resolveSuccessToast<TData, TVariables>(
  factory: MutationActionToastFactory<TData, TVariables> | undefined,
  data: TData,
  variables: TVariables,
) {
  if (!factory) {
    return null;
  }

  if (typeof factory === "function") {
    return factory(data, variables) ?? null;
  }

  return factory;
}

function resolveErrorToast<TVariables>(
  factory: MutationActionErrorToastFactory<TVariables> | undefined,
  error: unknown,
  variables: TVariables,
) {
  if (!factory) {
    return null;
  }

  if (typeof factory === "function") {
    return factory(error, variables) ?? null;
  }

  return factory;
}

export function useMutationActionWorkflow<TData, TVariables = void>({
  action,
  closeOnSuccess = true,
  errorToast,
  invalidateQueries,
  navigate,
  onClose,
  onError,
  onSuccess,
  successToast,
}: MutationActionWorkflowOptions<TData, TVariables>): MutationActionWorkflowResult<TData, TVariables> {
  const queryClient = useQueryClient();
  const [data, setData] = useState<TData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [isPending, setIsPending] = useState(false);
  const [toast, setToast] = useState<MutationActionToast | null>(null);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setToast(null);
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  const run = useCallback(
    async (variables?: TVariables) => {
      const actionVariables = variables as TVariables;
      setIsPending(true);
      setError(null);

      try {
        const result = await action(actionVariables);
        const queryKeys =
          typeof invalidateQueries === "function"
            ? await invalidateQueries(result, actionVariables)
            : invalidateQueries;

        if (queryKeys?.length) {
          await Promise.all(
            queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
          );
        }

        await onSuccess?.(result, actionVariables);
        setData(result);
        setToast(resolveSuccessToast(successToast, result, actionVariables));

        if (closeOnSuccess) {
          onClose?.();
        }

        await navigate?.(result, actionVariables);

        return result;
      } catch (caughtError) {
        setError(caughtError);
        setToast(resolveErrorToast(errorToast, caughtError, actionVariables));
        await onError?.(caughtError, actionVariables);
        throw caughtError;
      } finally {
        setIsPending(false);
      }
    },
    [
      action,
      closeOnSuccess,
      errorToast,
      invalidateQueries,
      navigate,
      onClose,
      onError,
      onSuccess,
      queryClient,
      successToast,
    ],
  );

  return {
    data,
    dismissToast,
    error,
    isError: Boolean(error),
    isPending,
    reset,
    run: run as MutationActionRun<TVariables, TData>,
    toast,
  };
}

export function MutationActionToast({
  onDismiss,
  toast,
}: {
  onDismiss: () => void;
  toast: MutationActionToast | null;
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
