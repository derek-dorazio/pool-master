import { useState } from 'react';
import {
  adminTransitionGolfTournament,
  adminUpdateGolfTournament,
} from '@/lib/api';
import {
  Button,
  Callout,
  ConfirmationModal,
  ListCard,
  StatusBadge,
  Tile,
  formatDateTimeDisplay,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import {
  formatSportEventStatus,
  sportEventStatusTone,
  type AdminGolfTournamentDetail,
  type AdminGolfTournamentRound,
  type GolfTournamentStatus,
} from './golf-admin-utils';
import { GolfTournamentRoundsModal } from './golf-tournament-rounds-modal';
import { GolfTournamentWorkflowRail } from './golf-tournament-workflow-rail';


/**
 * plans/124 §6.3 block 2 — the workflow rail, allowed transitions, the
 * automatic-lifecycle toggle, and the round schedule editor. Hidden entirely for
 * a fully provider-owned event (the caller renders nothing then).
 */
export function GolfTournamentWorkflowCard({
  eventId,
  rounds,
  roundsError,
  tournament,
}: {
  eventId: string;
  rounds: readonly AdminGolfTournamentRound[];
  roundsError: unknown;
  tournament: AdminGolfTournamentDetail;
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
      const response = await adminTransitionGolfTournament({
        path: { eventId },
        body: { toStatus },
      });
      if (!response.data?.tournament) {
        throw response.error ?? new Error('Golf tournament transition response is missing data.');
      }
      return response.data.tournament;
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
      const response = await adminUpdateGolfTournament({
        path: { eventId },
        body: { autoLifecycleEnabled },
      });
      if (!response.data?.tournament) {
        throw response.error ?? new Error('Golf tournament update response is missing data.');
      }
      return response.data.tournament;
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

      <div className="mt-4 flex flex-wrap gap-2">
        {tournament.workflow.allowedTransitions.length > 0 ? (
          tournament.workflow.allowedTransitions.map((toStatus) => (
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
