import { cn, formatCupPoints, Text, useDisplayPreferences } from '@/features/shared/ui';
import { joinNames } from './cup-view';
import type { PodiumStep } from './championship-view';

/** Each step's colours (in the stylesheet) and height, 1st tallest. */
const STEP_CLASS: Record<PodiumStep['place'], string> = {
  1: 'h-16 podium-step-1',
  2: 'h-12 podium-step-2',
  3: 'h-8 podium-step-3',
};

/** Left to right as a podium stands: 2nd, 1st, 3rd. */
const STANDING_ORDER: PodiumStep['place'][] = [2, 1, 3];

/**
 * 1st, 2nd and 3rd on their steps, every squad sharing a place named on it. `focusSquadId` marks
 * one squad: the viewer's, or the squad whose page shows it.
 */
export function Podium({ focusSquadId, steps, testId }: { focusSquadId: string | null; steps: PodiumStep[]; testId: string }) {
  const { locale } = useDisplayPreferences();
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
            <Text variant="strong" weight={isFocus ? 'bold' : 'semibold'}>
              {joinNames(step.squads.map((squad) => squad.squadName))}
            </Text>
            <Text variant="caption">{formatCupPoints(step.squads[0]?.points ?? 0, locale)} pts</Text>
            <span className={cn('flex w-full items-center justify-center rounded-t-lg', STEP_CLASS[place])} data-testid={`${testId}-${place}-step`}>
              <Text variant="numeral">{place}</Text>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
