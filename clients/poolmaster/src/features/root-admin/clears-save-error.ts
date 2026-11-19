import type { MutationActionWorkflowResult } from '@/features/shared/ui';

/** Typing again clears a failed save's reason, but never a toast already showing. */
export function clearsSaveError(save: Pick<MutationActionWorkflowResult<unknown, never>, 'isError' | 'reset'>): () => void {
  return () => {
    if (save.isError) save.reset();
  };
}
