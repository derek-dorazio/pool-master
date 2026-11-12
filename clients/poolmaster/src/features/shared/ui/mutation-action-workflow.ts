import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { refreshAfterWrite } from "@/lib/mutation-hooks";
import { showToast, type ToastMessage } from "./toast-store";

type MutationActionToast = ToastMessage;

type MutationActionToastFactory<TData, TVariables> =
  | MutationActionToast
  | ((data: TData, variables: TVariables) => MutationActionToast | null | undefined);

type MutationActionErrorToastFactory<TVariables> =
  | MutationActionToast
  | ((error: Error, variables: TVariables) => MutationActionToast | null | undefined);

type MutationActionInvalidate<TData, TVariables> =
  | readonly QueryKey[]
  | ((data: TData, variables: TVariables) => readonly QueryKey[] | Promise<readonly QueryKey[]>);

// `void` is TanStack Query's own marker for a mutation that takes no variables
// (`useMutation<TData, TError, void>`), so it is the type this has to test for.
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
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
  onError?: (error: Error, variables: TVariables) => void | Promise<void>;
  onSuccess?: (data: TData, variables: TVariables) => void | Promise<void>;
  successToast?: MutationActionToastFactory<TData, TVariables>;
};

export type MutationActionWorkflowResult<TData, TVariables = void> = {
  data: TData | null;
  error: Error | null;
  isError: boolean;
  isPending: boolean;
  reset: () => void;
  run: MutationActionRun<TVariables, TData>;
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
  error: Error,
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
  const [error, setError] = useState<Error | null>(null);
  const [isPending, setIsPending] = useState(false);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
  }, []);

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
          await refreshAfterWrite(queryClient, queryKeys);
        }

        await onSuccess?.(result, actionVariables);
        setData(result);
        const shownSuccess = resolveSuccessToast(successToast, result, actionVariables);
        if (shownSuccess) {
          // The app's one Toaster shows it, so it outlives the dialog this closes.
          showToast(shownSuccess);
        }

        if (closeOnSuccess) {
          onClose?.();
        }

        await navigate?.(result, actionVariables);

        return result;
      } catch (caughtError) {
        // Actions throw real Errors (SDK failures go through throwApiError);
        // anything else thrown is still a failure, so it is wrapped rather
        // than dropped, keeping `isError` true.
        const failure = caughtError instanceof Error ? caughtError : new Error(String(caughtError));
        setError(failure);
        const shownError = resolveErrorToast(errorToast, failure, actionVariables);
        if (shownError) {
          showToast(shownError);
        }
        await onError?.(failure, actionVariables);
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
    error,
    isError: error !== null,
    isPending,
    reset,
    run,
  };
}
