import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';

export type RowDrafts<TDraft> = Partial<Record<string, TDraft>>;

/**
 * The row-by-row editing loop a root admin correction grid runs (#1367): a draft of unsaved edits
 * per row, a save of one row at a time, that row's draft dropped once it saves, and every draft
 * and any stale save error cleared when `scope` (the event and its round or game) changes. The
 * caller sends the row to its own endpoint in `saveRow` and logs a rejected save in `onSaveError`.
 */
export function useRowCorrections<TDraft, TBody>({
  scope,
  saveRow,
  invalidates,
  onSaveError,
}: {
  scope: string;
  saveRow: (rowId: string, body: TBody) => Promise<unknown>;
  invalidates: readonly QueryKey[];
  onSaveError: (error: Error) => void;
}): {
  draft: RowDrafts<TDraft>;
  setDraft: Dispatch<SetStateAction<RowDrafts<TDraft>>>;
  /** The row whose save is in flight, if any. */
  savingId: string | null;
  save: (rowId: string, body: TBody) => void;
  saveError: Error | null;
} {
  const [draft, setDraft] = useState<RowDrafts<TDraft>>({});
  const [draftScope, setDraftScope] = useState(scope);

  const saveMutation = useInvalidatingMutation({
    mutationFn: ({ rowId, body }: { rowId: string; body: TBody }) => saveRow(rowId, body),
    invalidates,
    onSuccess: (_data, variables) =>
      setDraft((current) => {
        const next = { ...current };
        delete next[variables.rowId];
        return next;
      }),
    onError: (error) => onSaveError(error),
  });

  // A new scope starts with no draft and no stale save error, reset in the render phase (not an effect).
  if (draftScope !== scope) {
    setDraftScope(scope);
    setDraft({});
    if (saveMutation.isError) {
      saveMutation.reset();
    }
  }

  const { mutate } = saveMutation;
  const save = useCallback((rowId: string, body: TBody) => mutate({ rowId, body }), [mutate]);

  return {
    draft,
    setDraft,
    savingId: saveMutation.isPending ? saveMutation.variables.rowId : null,
    save,
    saveError: saveMutation.isError ? saveMutation.error : null,
  };
}
