import { useState } from 'react';
import { refreshEventParticipants } from '@/lib/api';
import { Alert, Button, ConfirmationModal } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { participantFieldActionLabel } from './sport-admin-utils';

/**
 * plans/124 §6.3 / §4.4a Field editor header — "Load Participant Field" while the
 * field is empty, "Refresh Participant Field" once it has entries (one endpoint,
 * client-computed label). Only rendered when `syncScope !== 'NONE'`. The first,
 * empty-field click runs with no confirmation; every later click confirms,
 * because a refresh replaces the ranking, odds, seed and withdrawal of every
 * participant the provider reports, including ones an admin set in the field grid
 * or by bulk upload (#415).
 */
export function EventFieldRefreshAction({
  eventId,
  fieldCount,
}: {
  eventId: string;
  fieldCount: number;
}) {
  const logger = getLogger().child({
    feature: 'root-admin-sport-event-field-page',
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const label = participantFieldActionLabel(fieldCount);

  const refreshMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await refreshEventParticipants({ path: { eventId } });
      if (!response.data?.syncRuns) {
        throwApiError(response.error, 'Field refresh response is missing data.');
      }
      return response.data.syncRuns;
    },
    invalidates: [
      QueryKeys.rootAdmin.manageSport.field(eventId),
      QueryKeys.rootAdmin.manageSport.event(eventId),
      QueryKeys.rootAdmin.manageSport.events,
      QueryKeys.rootAdmin.manageSport.tiers(eventId),
    ],
    onSuccess: () => {
      setStarted(true);
      setConfirmOpen(false);
    },
    onError: (error) => {
      logger.warn(
        { action: 'golf.field.refresh.failed', err: error },
        'Field refresh was rejected',
      );
    },
  });

  return (
    <>
      <Button
        data-testid="root-admin-event-field-refresh"
        isLoading={refreshMutation.isPending && fieldCount === 0}
        onClick={() => {
          setStarted(false);
          if (fieldCount === 0) {
            refreshMutation.mutate();
          } else {
            setConfirmOpen(true);
          }
        }}
        size="sm"
        variant="secondary"
      >
        {label}
      </Button>

      {started ? (
        <Alert
          className="mt-3"
          data-testid="root-admin-event-field-refresh-result"
          tone="info"
        >
          Provider field sync started. The field updates here once the run
          completes.
        </Alert>
      ) : null}

      {refreshMutation.isError && !confirmOpen ? (
        <Alert
          className="mt-3"
          data-testid="root-admin-event-field-refresh-error"
          tone="danger"
        >
          {extractErrorMessage(refreshMutation.error, {
            fallback: 'We could not start the provider field sync.',
          })}
        </Alert>
      ) : null}

      <ConfirmationModal
        confirmLabel={label}
        confirmTestId="root-admin-event-field-refresh-confirm"
        description="Pulls the field again from the linked provider event. For every participant the provider reports, rankings, odds, seeds and withdrawals you set in the field grid or by bulk upload are replaced with the provider's values."
        errorMessage={
          refreshMutation.isError && confirmOpen
            ? extractErrorMessage(refreshMutation.error, {
                fallback: 'We could not start the provider field sync.',
              })
            : undefined
        }
        isPending={refreshMutation.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => refreshMutation.mutate()}
        onOpenChange={(next) => !next && setConfirmOpen(false)}
        open={confirmOpen}
        testId="root-admin-event-field-refresh-modal"
        title={label}
      />
    </>
  );
}
