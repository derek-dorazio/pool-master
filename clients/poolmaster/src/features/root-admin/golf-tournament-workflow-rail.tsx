import {
  ProgressIndicator,
  StatusBadge,
  formatDateTimeDisplay,
} from '@/features/shared/ui';
import {
  GOLF_LIFECYCLE_STAGES,
  deriveGolfAutoTransition,
  formatSportEventStatus,
  resolveGolfLifecycleStage,
  type AdminGolfTournamentDetail,
  type AdminGolfTournamentRound,
} from './golf-admin-utils';

/**
 * plans/124 §6.3 block 2 — the horizontal lifecycle rail
 * (Setup → Field open → Field locked → Live → Completed) with the current stage
 * marked, plus the auto-lifecycle hint when the scheduler will advance it.
 */
export function GolfTournamentWorkflowRail({
  rounds,
  tournament,
}: {
  rounds: readonly AdminGolfTournamentRound[];
  tournament: AdminGolfTournamentDetail;
}) {
  const stage = resolveGolfLifecycleStage({
    status: tournament.status,
    fieldLocked: tournament.fieldLocked,
    releaseAt: tournament.releaseAt,
  });
  const auto = deriveGolfAutoTransition({
    status: tournament.status,
    autoLifecycleEnabled: tournament.autoLifecycleEnabled,
    syncScope: tournament.syncScope,
    startDate: tournament.startDate,
    endDate: tournament.endDate || null,
    rounds,
  });

  return (
    <div className="space-y-3">
      <ol
        className="flex flex-wrap gap-2"
        data-testid="root-admin-golf-tournament-workflow-rail"
      >
        {GOLF_LIFECYCLE_STAGES.map((railStage, index) => {
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
          max={GOLF_LIFECYCLE_STAGES.length - 1}
          value={stage.index}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          This tournament is {formatSportEventStatus(tournament.status)} and off the
          standard lifecycle rail.
        </p>
      )}

      {auto ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="root-admin-golf-tournament-auto-hint"
        >
          Will move to {formatSportEventStatus(auto.toStatus)} automatically around{' '}
          {formatDateTimeDisplay(auto.at)} from the round schedule. Manual transitions stay
          available.
        </p>
      ) : null}
    </div>
  );
}
