import { useState } from 'react';
import { rebuildEventLeaderboards } from '@/lib/api';
import { Button, ConfirmDialog, showToast, type DetailAction } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';

const logger = getLogger().child({ feature: 'root-admin-settle-again' });

const DESCRIPTION = 'Rebuilds every leaderboard on this event\'s contests from the results stored now. No result changes.';

/**
 * Settle again (#1890), from a round's or a match's dialog: one rebuild of the event's contests'
 * boards queued in the background, which shows in Activity. The action goes in the dialog's
 * Actions section; while its confirm is open the dialog is hidden, as the event ⚙'s actions are.
 */
export function useSettleAgain(eventId: string, testId: string) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const mutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await rebuildEventLeaderboards({ path: { eventId } });
      if (response.error !== undefined) throwApiError(response.error, 'The leaderboard rebuild was not queued.');
    },
    invalidates: [QueryKeys.rootAdmin.activity],
    onSuccess: () => {
      setConfirmOpen(false);
      showToast({ title: 'Leaderboard rebuild queued', tone: 'success' });
    },
    onError: (error) => logger.warn({ action: 'event.settle-again.failed', data: { eventId }, err: error }, 'Settle again was refused'),
  });

  const action: DetailAction = {
    id: 'settle-again',
    name: 'Settle again',
    description: DESCRIPTION,
    control: (
      <Button data-testid={`${testId}-settle-again`} onClick={() => setConfirmOpen(true)} size="sm" variant="secondary">
        Settle again
      </Button>
    ),
  };

  const confirmDialog = (
    <ConfirmDialog
      confirmLabel="Settle again"
      confirmTestId={`${testId}-settle-again-confirm`}
      description={DESCRIPTION}
      error={mutation.isError ? extractErrorMessage(mutation.error, { fallback: 'We could not queue the rebuild.' }) : undefined}
      isPending={mutation.isPending}
      onCancel={() => setConfirmOpen(false)}
      onConfirm={() => mutation.mutate()}
      onOpenChange={(open) => (open ? undefined : setConfirmOpen(false))}
      open={confirmOpen}
      testId={`${testId}-settle-again-modal`}
      title="Settle again"
    />
  );

  return { action, confirmDialog, confirmOpen };
}
