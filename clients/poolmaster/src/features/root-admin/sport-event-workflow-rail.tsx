import { getSportDefinition } from '@poolmaster/shared/domain';
import {
  StageTrack,
  Text,
  formatDateTimeDisplay,
  useDisplayPreferences,
} from '@/features/shared/ui';
import {
  EVENT_LIFECYCLE_STAGES,
  deriveEventAutoTransition,
  formatSportEventStatus,
  resolveEventLifecycleStage,
} from './sport-admin-utils';
import type { SportEventDto, SportEventRoundDto } from '@/lib/api';

/**
 * An event's lifecycle (Draft → Released for contests → Live → Completed) on the shared stage
 * track, the one a contest's Manage page uses, plus the hint when the scheduler will advance it.
 */
export function SportEventWorkflowRail({
  rounds,
  tournament,
}: {
  rounds: readonly SportEventRoundDto[];
  tournament: SportEventDto;
}) {
  const displayPreferences = useDisplayPreferences();
  const stage = resolveEventLifecycleStage(tournament.status);
  const auto = deriveEventAutoTransition({
    status: tournament.status,
    autoLifecycleEnabled: tournament.autoLifecycleEnabled,
    startDate: tournament.startDate,
    endDate: tournament.endDate || null,
    rounds,
  });

  const { event, round } = getSportDefinition(tournament.sport).vocabulary;

  return (
    <div className="space-y-3">
      {stage ? (
        <StageTrack
          currentIndex={stage.index}
          stages={EVENT_LIFECYCLE_STAGES.map((railStage) => railStage.label)}
          testId="root-admin-sport-event-workflow-rail"
        />
      ) : (
        // Off the track (cancelled, postponed): say where it is instead.
        <Text as="p" data-testid="root-admin-sport-event-workflow-off-track" variant="meta">
          This {event.one} is {formatSportEventStatus(tournament.status)}.
        </Text>
      )}

      {auto ? (
        <Text as="p" data-testid="root-admin-sport-event-auto-hint" variant="meta">
          Will move to {formatSportEventStatus(auto.toStatus)} automatically around{' '}
          {formatDateTimeDisplay(auto.at, displayPreferences)} from the {round.one} schedule. Manual
          transitions stay available.
        </Text>
      ) : null}
    </div>
  );
}
