import { useState } from 'react';
import { transitionEvent, updateEvent } from '@/lib/api';
import {
  Button,
  Callout,
  ConfirmationModal,
  formatDateTimeDisplay,
  Heading,
  LinkButton,
  ListCard,
  StatusBadge,
  Tile,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import {
  formatSportEventStatus,
  sportEventStatusTone,
  type SportEventDtoStatus,
} from './sport-admin-utils';
import { SportEventReleaseAction } from './sport-event-release-action';
import { SportEventWorkflowRail } from './sport-event-workflow-rail';
import { buildSportEventPath, capitalize } from './manage-navigation';
import { useEventRoundLabel } from './use-sport-catalog';
import type { SportEventDto, SportEventRoundDto } from '@/lib/api';
import { SportEventStatus, getSportDefinition } from '@poolmaster/shared/domain';

/**
 * plans/124 §6.3 block 2 — the workflow rail, "Release for contests" while the tournament
 * is a draft (#431), allowed transitions, the automatic-lifecycle toggle, and the round
 * schedule with a link to its page.
 */
export function SportEventWorkflowCard({
  eventId,
  rounds,
  roundsError,
  tournament,
}: {
  eventId: string;
  rounds: readonly SportEventRoundDto[];
  roundsError: Error | null;
  tournament: SportEventDto;
}) {
  const displayPreferences = useDisplayPreferences();
  const logger = getLogger().child({
    feature: 'root-admin-sport-event-home-page',
  });
  const definition = getSportDefinition(tournament.sport);
  const { event, round: roundNoun } = definition.vocabulary;
  const roundLabel = useEventRoundLabel(tournament);
  const [transitionTarget, setTransitionTarget] =
    useState<SportEventDtoStatus | null>(null);
  const [autoToggleOpen, setAutoToggleOpen] = useState(false);

  const transitionMutation = useInvalidatingMutation({
    mutationFn: async (toStatus: SportEventDtoStatus) => {
      const response = await transitionEvent({
        path: { eventId },
        body: { toStatus },
      });
      if (!response.data?.event) {
        throwApiError(response.error, `The ${event.one} transition response is missing data.`);
      }
      return response.data.event;
    },
    invalidates: [
      QueryKeys.rootAdmin.manageSport.event(eventId),
      QueryKeys.rootAdmin.manageSport.events,
    ],
    onSuccess: () => setTransitionTarget(null),
    onError: (error) => {
      logger.warn(
        { action: 'event.transition.failed', err: error },
        'Event transition was rejected',
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
        throwApiError(response.error, `The ${event.one} update response is missing data.`);
      }
      return response.data.event;
    },
    invalidates: [QueryKeys.rootAdmin.manageSport.event(eventId)],
    onSuccess: () => setAutoToggleOpen(false),
    onError: (error) => {
      logger.warn(
        { action: 'event.auto-lifecycle.failed', err: error },
        'Event auto-lifecycle toggle was rejected',
      );
    },
  });

  return (
    <Tile>
      <div className="flex items-start justify-between gap-3">
        <Heading level={2} variant="card" size="lg">Workflow</Heading>
        <StatusBadge tone={sportEventStatusTone(tournament.status)}>
          {formatSportEventStatus(tournament.status)}
        </StatusBadge>
      </div>

      <div className="mt-4">
        <SportEventWorkflowRail rounds={rounds} tournament={tournament} />
      </div>

      {tournament.status === SportEventStatus.DRAFT ? (
        <div className="mt-4">
          <SportEventReleaseAction eventId={eventId} tournament={tournament} />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {tournament.allowedTransitions.length > 0 ? (
          tournament.allowedTransitions.map((toStatus) => (
            <Button
              data-testid={`root-admin-sport-event-transition-${toStatus}`}
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
          data-testid="root-admin-sport-event-auto-toggle"
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
            ? `The background scheduler advances this ${event.one} from its ${roundNoun.one} schedule.`
            : 'Automatic lifecycle is off — every transition is manual.'}
        </span>
      </div>

      <ListCard
        actions={
          <LinkButton
            data-testid="root-admin-sport-event-rounds-edit"
            size="sm"
            to={`${buildSportEventPath(tournament.sport, eventId)}/schedule`}
            variant="secondary"
          >
            Edit schedule
          </LinkButton>
        }
        className="mt-4"
        description={
          roundsError
            ? extractErrorMessage(roundsError, {
                fallback: `${capitalize(roundNoun.one)} schedule is unavailable.`,
              })
            : rounds.length === 0
              ? `No ${roundNoun.many} recorded yet.`
              : rounds
                  .map(
                    (round) =>
                      `${roundLabel(round.roundNumber, rounds.length)} ${formatDateTimeDisplay(round.scheduledDate, displayPreferences)}`,
                  )
                  .join(' · ')
        }
        title={capitalize(roundNoun.many)}
      />

      <ConfirmationModal
        confirmLabel={
          transitionTarget
            ? `Move to ${formatSportEventStatus(transitionTarget)}`
            : 'Confirm'
        }
        confirmTestId="root-admin-sport-event-transition-confirm"
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
        testId="root-admin-sport-event-transition-modal"
        title={`Change ${event.one} status`}
        tone="danger"
      />

      <ConfirmationModal
        confirmLabel={
          tournament.autoLifecycleEnabled
            ? 'Turn off automatic lifecycle'
            : 'Turn on automatic lifecycle'
        }
        confirmTestId="root-admin-sport-event-auto-confirm"
        description={`The background scheduler only advances a ${event.one} while automatic lifecycle is on.`}
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
        testId="root-admin-sport-event-auto-modal"
        title="Automatic lifecycle"
      />
    </Tile>
  );
}
