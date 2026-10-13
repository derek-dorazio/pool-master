import { getSportDefinition } from '@poolmaster/shared/domain';
import {
  ProgressIndicator,
  StatusBadge,
  formatDateTimeDisplay,
} from '@/features/shared/ui';
import {
  EVENT_LIFECYCLE_STAGES,
  deriveEventAutoTransition,
  formatSportEventStatus,
  resolveEventLifecycleStage,
} from './sport-admin-utils';
import type { SportEventDto, SportEventRoundDto } from '@/lib/api';

/**
 * plans/124 §6.3 block 2 — the horizontal lifecycle rail
 * (Draft → Released for contests → Live → Completed, #431) with the current stage
 * marked, plus the auto-lifecycle hint when the scheduler will advance it.
 */
export function SportEventWorkflowRail({
  rounds,
  tournament,
}: {
  rounds: readonly SportEventRoundDto[];
  tournament: SportEventDto;
}) {
  const stage = resolveEventLifecycleStage(tournament.status);
  const auto = deriveEventAutoTransition({
    status: tournament.status,
    autoLifecycleEnabled: tournament.autoLifecycleEnabled,
    startDate: tournament.startDate,
    endDate: tournament.endDate || null,
    rounds,
  });

  return (
    <div className="space-y-3">
      <ol
        className="flex flex-wrap gap-2"
        data-testid="root-admin-sport-event-workflow-rail"
      >
        {EVENT_LIFECYCLE_STAGES.map((railStage, index) => {
          const state = !stage
            ? 'off the rail'
            : index === stage.index
              ? 'current'
              : index < stage.index
                ? 'done'
                : 'upcoming';
          const tone = !stage
            ? 'neutral'
            : index === stage.index
              ? 'active'
              : index < stage.index
                ? 'success'
                : 'inactive';
          return (
            <li key={railStage.key}>
              <StatusBadge aria-current={state === 'current' ? 'step' : undefined} tone={tone}>
                {railStage.label}
                <span className="sr-only"> — {state}</span>
              </StatusBadge>
            </li>
          );
        })}
      </ol>

      {stage ? (
        <ProgressIndicator
          label={`Current stage: ${stage.label}`}
          max={EVENT_LIFECYCLE_STAGES.length - 1}
          value={stage.index}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          This {getSportDefinition(tournament.sport).vocabulary.event.one} is{' '}
          {formatSportEventStatus(tournament.status)}.
        </p>
      )}

      {auto ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="root-admin-sport-event-auto-hint"
        >
          Will move to {formatSportEventStatus(auto.toStatus)} automatically around{' '}
          {formatDateTimeDisplay(auto.at)} from the{' '}
          {getSportDefinition(tournament.sport).vocabulary.round.one} schedule. Manual transitions stay
          available.
        </p>
      ) : null}
    </div>
  );
}
