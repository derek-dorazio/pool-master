import { useState } from 'react';
import { transitionEvent, updateEvent } from '@/lib/api';
import {
  Button,
  Callout,
  ConfirmationModal,
  ListCard,
  StatusBadge,
  Tile,
  formatDateTimeDisplay,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import {
  formatSportEventStatus,
  sportEventStatusTone,
  type GolfTournamentStatus,
} from './golf-admin-utils';
import { GolfTournamentReleaseAction } from './golf-tournament-release-action';
import { GolfTournamentRoundsModal } from './golf-tournament-rounds-modal';
import { GolfTournamentWorkflowRail } from './golf-tournament-workflow-rail';
import type { SportEventDto, SportEventRoundDto } from '@/lib/api';
import { SportEventStatus } from '@poolmaster/shared/domain';

/**
 * plans/124 §6.3 block 2 — the workflow rail, "Release for contests" while the tournament
 * is a draft (#431), allowed transitions, the automatic-lifecycle toggle, and the round
 * schedule editor.
 */
export function GolfTournamentWorkflowCard({
  eventId,
  rounds,
  roundsError,
  tournament,
}: {
  eventId: string;
  rounds: readonly SportEventRoundDto[];
  roundsError: unknown;
  tournament: SportEventDto;
}) {
  const logger = getLogger().child({
    feature: 'root-admin-golf-tournament-home-page',
  });
  const [transitionTarget, setTransitionTarget] =
    useState<GolfTournamentStatus | null>(null);
  const [autoToggleOpen, setAutoToggleOpen] = useState(false);
  const [roundsOpen, setRoundsOpen] = useState(false);

  const transitionMutation = useInvalidatingMutation({
    mutationFn: async (toStatus: GolfTournamentStatus) => {
      const response = await transitionEvent({
        path: { eventId },
        body: { toStatus },
      });
      if (!response.data?.event) {
        throwApiError(response.error, 'Golf tournament transition response is missing data.');
      }
      return response.data.event;
    },
    invalidates: [
      QueryKeys.rootAdmin.golf.tournament(eventId),
      QueryKeys.rootAdmin.golf.tournaments,
    ],
    onSuccess: () => setTransitionTarget(null),
    onError: (error) => {
      logger.warn(
        { action: 'golf.tournament.transition.failed', err: error },
        'Golf tournament transition was rejected',
      );
    },
  });

  const autoMutation = useInvalidatingMutation({
    mutationFn: async (autoLifecycleEnabled: boolean) => {
      const response = await updateEvent({
        path: { eventId },
        body: { autoLifecycleEnabled },
      });
      if (!response.data?.event) {
        throwApiError(response.error, 'Golf tournament update response is missing data.');
      }
      return response.data.event;
    },
    invalidates: [QueryKeys.rootAdmin.golf.tournament(eventId)],
    onSuccess: () => setAutoToggleOpen(false),
    onError: (error) => {
      logger.warn(
        { action: 'golf.tournament.auto-lifecycle.failed', err: error },
        'Golf tournament auto-lifecycle toggle was rejected',
      );
    },
  });

  return (
    <Tile>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Workflow</h2>
        <StatusBadge tone={sportEventStatusTone(tournament.status)}>
          {formatSportEventStatus(tournament.status)}
        </StatusBadge>
      </div>

      <div className="mt-4">
        <GolfTournamentWorkflowRail rounds={rounds} tournament={tournament} />
      </div>

      {tournament.status === SportEventStatus.DRAFT ? (
        <div className="mt-4">
          <GolfTournamentReleaseAction eventId={eventId} tournament={tournament} />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {tournament.allowedTransitions.length > 0 ? (
          tournament.allowedTransitions.map((toStatus) => (
            <Button
              data-testid={`root-admin-golf-tournament-transition-${toStatus}`}
              key={toStatus}
              onClick={() => setTransitionTarget(toStatus)}
              size="sm"
              type="button"
              variant="secondary"
            >
              Move to {formatSportEventStatus(toStatus)}
            </Button>
          ))
        ) : (
          <Callout tone="info">
            No lifecycle transitions are available from{' '}
            {formatSportEventStatus(tournament.status)} right now.
          </Callout>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Button
          data-testid="root-admin-golf-tournament-auto-toggle"
          onClick={() => setAutoToggleOpen(true)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {tournament.autoLifecycleEnabled
            ? 'Manage lifecycle manually'
            : 'Re-enable automatic lifecycle'}
        </Button>
        <span>
          {tournament.autoLifecycleEnabled
            ? 'The background scheduler advances this tournament from its round schedule.'
            : 'Automatic lifecycle is off — every transition is manual.'}
        </span>
      </div>

      <ListCard
        actions={
          <Button
            data-testid="root-admin-golf-tournament-rounds-edit"
            onClick={() => setRoundsOpen(true)}
            size="sm"
            type="button"
            variant="secondary"
          >
            Edit schedule
          </Button>
        }
        className="mt-4"
        description={
          roundsError
            ? extractErrorMessage(roundsError, {
                fallback: 'Round schedule is unavailable.',
              })
            : rounds.length === 0
              ? 'No rounds recorded yet.'
              : rounds
                  .map(
                    (round) =>
                      `R${round.roundNumber} ${formatDateTimeDisplay(round.scheduledDate)}`,
                  )
                  .join(' · ')
        }
        title="Rounds"
      />

      <ConfirmationModal
        confirmLabel={
          transitionTarget
            ? `Move to ${formatSportEventStatus(transitionTarget)}`
            : 'Confirm'
        }
        confirmTestId="root-admin-golf-tournament-transition-confirm"
        description="This can activate or settle contests downstream and is hard to reverse."
        errorMessage={
          transitionMutation.isError
            ? extractErrorMessage(transitionMutation.error, {
                fallback: 'The transition was rejected.',
              })
            : undefined
        }
        isPending={transitionMutation.isPending}
        onCancel={() => setTransitionTarget(null)}
        onConfirm={() => transitionTarget && transitionMutation.mutate(transitionTarget)}
        onOpenChange={(open) => !open && setTransitionTarget(null)}
        open={transitionTarget !== null}
        testId="root-admin-golf-tournament-transition-modal"
        title="Change tournament status"
        tone="danger"
      />

      <ConfirmationModal
        confirmLabel={
          tournament.autoLifecycleEnabled
            ? 'Turn off automatic lifecycle'
            : 'Turn on automatic lifecycle'
        }
        confirmTestId="root-admin-golf-tournament-auto-confirm"
        description="The background scheduler only advances a tournament while automatic lifecycle is on."
        errorMessage={
          autoMutation.isError
            ? extractErrorMessage(autoMutation.error, {
                fallback: 'The change was rejected.',
              })
            : undefined
        }
        isPending={autoMutation.isPending}
        onCancel={() => setAutoToggleOpen(false)}
        onConfirm={() => autoMutation.mutate(!tournament.autoLifecycleEnabled)}
        onOpenChange={(open) => !open && setAutoToggleOpen(false)}
        open={autoToggleOpen}
        testId="root-admin-golf-tournament-auto-modal"
        title="Automatic lifecycle"
      />

      <GolfTournamentRoundsModal
        eventId={eventId}
        key={roundsOpen ? 'rounds-open' : 'rounds-closed'}
        onClose={() => setRoundsOpen(false)}
        open={roundsOpen}
        rounds={rounds}
      />
    </Tile>
  );
}
