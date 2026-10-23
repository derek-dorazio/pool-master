import { cn } from '@/features/shared/ui';
import { formatCupPoints, joinNames } from './cup-view';
import type { PodiumStep } from './championship-view';

/** Each step's colors and height, 1st tallest. */
const STEP_CLASS: Record<PodiumStep['place'], string> = {
  1: 'h-16 bg-podium-1 text-podium-1-foreground',
  2: 'h-12 bg-podium-2 text-podium-2-foreground',
  3: 'h-8 bg-podium-3 text-podium-3-foreground',
};

/** Left to right as a podium stands: 2nd, 1st, 3rd. */
const STANDING_ORDER: PodiumStep['place'][] = [2, 1, 3];

/**
 * 1st, 2nd and 3rd on their steps, every squad sharing a place named on it. `focusSquadId` marks
 * one squad: the viewer's, or the squad whose page shows it.
 */
export function Podium({ focusSquadId, steps, testId }: { focusSquadId: string | null; steps: PodiumStep[]; testId: string }) {
  const byPlace = new Map(steps.map((step) => [step.place, step]));
  return (
    <ol aria-label="Podium" className="grid grid-cols-3 items-end gap-2" data-testid={testId}>
      {STANDING_ORDER.map((place) => {
        const step = byPlace.get(place);
        if (!step) {
          return <li aria-hidden className="h-0" key={place} />;
        }
        const isFocus = step.squads.some((squad) => squad.squadId === focusSquadId);
        return (
          <li className="flex flex-col items-center gap-1 text-center" data-testid={`${testId}-${place}`} key={place}>
            <span className={cn('text-sm text-foreground', isFocus ? 'font-bold' : 'font-semibold')}>
              {joinNames(step.squads.map((squad) => squad.squadName))}
            </span>
            <span className="text-xs text-muted-foreground">{formatCupPoints(step.squads[0]?.points ?? 0)} pts</span>
            <span className={cn('flex w-full items-center justify-center rounded-t-lg text-xl font-black', STEP_CLASS[place])}>
              {place}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
