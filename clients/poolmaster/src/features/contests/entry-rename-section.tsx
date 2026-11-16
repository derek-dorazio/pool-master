import { useState } from 'react';
import { updateContestEntry } from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { SectionCard } from '@/features/shared/ui';
import { EntryNameField } from './entry-name-field';
import { entryWriteKeys } from './use-contest-entries';

/**
 * The entry's name on a pick screen whose picks save one at a time (#1739): a random draw's,
 * a pick'em week's, a bracket's, a squares grid's. Editing an entry covers its picks and its
 * name, so the contest page has no Rename of its own. A roster lineup names its entry in its
 * own Submit section instead.
 */
export function EntryRenameSection({
  contestId,
  entryId,
  savedName,
}: {
  contestId: string;
  entryId: string;
  /** The entry's name as saved. */
  savedName: string;
}) {
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

  return (
    <SectionCard headingLevel={3} padded testId="contest-entry-rename" title="Entry name">
      <EntryNameField
        error={rename.isError ? extractErrorMessage(rename.error) : null}
        onChange={setDraft}
        save={draft !== null && draft.trim() !== savedName ? {
          cancelTestId: 'contest-entry-rename-cancel',
          isSaving: rename.isPending,
          onCancel: () => {
            setDraft(null);
            rename.reset();
          },
          onSave: (name) => void rename.mutateAsync(name).catch(() => undefined),
          saveTestId: 'contest-entry-rename-save',
        } : undefined}
        testId="contest-entry-rename-input"
        value={value}
      />
    </SectionCard>
  );
}
