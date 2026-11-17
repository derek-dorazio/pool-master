import { useState } from 'react';
import { updateContestEntry } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { entryWriteKeys } from './use-contest-entries';

/**
 * The entry's name on a pick screen whose picks save one at a time (#1769): the draft being typed
 * in the Name and submit card, and the save that the card's one button runs.
 */
export function useEntryName({ contestId, entryId, savedName }: { contestId: string; entryId: string; savedName: string }) {
  // Null until the viewer types, so a refetch never overwrites what is being typed.
  const [draft, setDraft] = useState<string | null>(null);
  const rename = useInvalidatingMutation({
    mutationFn: async (name: string) => {
      const response = await updateContestEntry({ path: { contestId, entryId }, body: { name } });
      if (!response.data?.entry) {
        throwApiError(response.error, 'Contest entry rename response is missing data.');
      }
      return response.data.entry;
    },
    onSuccess: () => setDraft(null),
    invalidates: [...entryWriteKeys(contestId), QueryKeys.contestEntries.detail(contestId, entryId)],
  });
  const value = draft ?? savedName;
  const trimmed = value.trim();
  return {
    /** The name typed differs from the saved one, so the card's button saves it. */
    isChanged: draft !== null && trimmed !== savedName,
    isValid: trimmed !== '',
    onChange: setDraft,
    rename,
    /** Saves the typed name when it changed; a refusal rejects. */
    save: async () => {
      if (draft !== null && trimmed !== savedName && trimmed !== '') {
        await rename.mutateAsync(trimmed);
      }
    },
    value,
  };
}
