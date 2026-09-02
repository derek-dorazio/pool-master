import { useState } from 'react';
import { adminRefreshGolfTournamentField } from '@/lib/api';
import { Alert, Button, ConfirmationModal } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { golfParticipantFieldActionLabel } from './golf-admin-utils';

/**
 * plans/124 §6.3 / §4.4a Field editor header — "Load Participant Field" while the
 * field is empty, "Refresh Participant Field" once it has entries (one endpoint,
 * client-computed label). Only rendered when `syncScope !== 'NONE'`. The first,
 * empty-field click runs with no confirmation; every later click confirms,
 * because a refresh can overwrite manually-adjusted rank / odds.
 */
export function GolfFieldRefreshAction({
  eventId,
  fieldCount,
}: {
  eventId: string;
  fieldCount: number;
}) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-tournament-field-page',
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const label = golfParticipantFieldActionLabel(fieldCount);

  const refreshMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await adminRefreshGolfTournamentField({ path: { eventId } });
      if (!response.data?.syncRuns) {
        throw response.error ?? new Error('Field refresh response is missing data.');
      }
      return response.data.syncRuns;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.field(eventId),
      QueryKeys.rootAdmin.golf.tournament(eventId),
      QueryKeys.rootAdmin.golf.tournaments,
      QueryKeys.rootAdmin.golf.tiers(eventId),
    ],
    onSuccess: () => {
      setStarted(true);
      setConfirmOpen(false);
    },
    onError: (error) => {
      logger.warn(
        { action: 'golf.field.refresh.failed', err: error },
        'Golf field refresh was rejected',
      );
    },
  });

  return (
    <>
      <Button
        data-testid="root-admin-golf-field-refresh"
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
          data-testid="root-admin-golf-field-refresh-result"
          tone="info"
        >
          Provider field sync started. The field updates here once the run
          completes.
        </Alert>
      ) : null}

      {refreshMutation.isError && !confirmOpen ? (
        <Alert
          className="mt-3"
          data-testid="root-admin-golf-field-refresh-error"
          tone="danger"
        >
          {extractErrorMessage(refreshMutation.error, {
            fallback: 'We could not start the provider field sync.',
          })}
        </Alert>
      ) : null}

      <ConfirmationModal
        confirmLabel={label}
        confirmTestId="root-admin-golf-field-refresh-confirm"
        description="Pulls the field again from the linked provider event. This can overwrite manually-adjusted world rank and odds for any golfer the provider still reports."
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
        testId="root-admin-golf-field-refresh-modal"
        title={label}
      />
    </>
  );
}
