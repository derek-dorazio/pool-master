import {
  useMutation as useTanStackMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';

type MutationInvalidates<TData, TVariables, TContext> =
  | readonly QueryKey[]
  | ((
    data: TData,
    variables: TVariables,
    context: TContext | undefined,
  ) => readonly QueryKey[] | Promise<readonly QueryKey[]>);

type UseInvalidatingMutationOptions<TData, TError, TVariables, TContext> =
  UseMutationOptions<TData, TError, TVariables, TContext> & {
    invalidates: MutationInvalidates<TData, TVariables, TContext>;
  };

async function resolveInvalidates<TData, TVariables, TContext>(
  invalidates: MutationInvalidates<TData, TVariables, TContext>,
  data: TData,
  variables: TVariables,
  context: TContext | undefined,
): Promise<readonly QueryKey[]> {
  if (typeof invalidates === 'function') {
    return invalidates(data, variables, context);
  }

  return invalidates;
}

export function useInvalidatingMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TContext = unknown,
>({
  invalidates,
  onSuccess,
  ...options
}: UseInvalidatingMutationOptions<TData, TError, TVariables, TContext>): UseMutationResult<
  TData,
  TError,
  TVariables,
  TContext
> {
  const queryClient = useQueryClient();

  return useTanStackMutation<TData, TError, TVariables, TContext>({
    ...options,
    onSuccess: async (data, variables, context, mutation) => {
      await onSuccess?.(data, variables, context, mutation);
      const queryKeys = await resolveInvalidates(invalidates, data, variables, context);

      if (queryKeys.length === 0) {
        return;
      }

      await Promise.all(
        queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
  });
}
