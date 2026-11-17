import type { ReactNode } from 'react';
import { Text, cn } from '@/features/shared/ui';
import { BracketChampionCard } from './bracket-champion-card';
import { BracketTree, type BracketPicking } from './bracket-tree';
import { splitMiddle, type BracketChampion, type BracketGroup } from './bracket-view-model';

/**
 * Where a bracket's regions meet (#1753): the first semifinal on the left, the second on the
 * right, and in the centre the final with the champion card under it, then the tiebreaker. The
 * middle of a desktop bracket and a phone's Final Four tab are the same drawing.
 */
export function BracketMiddle({
  champion,
  columnClassName,
  isOwnEntry,
  middle,
  picking,
  tiebreaker,
}: {
  champion: BracketChampion | null;
  columnClassName: string;
  isOwnEntry: boolean;
  middle: BracketGroup;
  picking: BracketPicking | null;
  tiebreaker?: ReactNode;
}) {
  const { final, left, right } = splitMiddle(middle);
  const finalRound = final ? middle.rounds.at(-1) : undefined;
  return (
    <div className="flex flex-col items-center gap-4" data-testid="bracket-middle">
      <div className="flex w-full items-center justify-center gap-2">
        {left.length > 0 ? <BracketTree columnClassName={columnClassName} picking={picking} rounds={left} showHeaders /> : null}
        {final && finalRound ? (
          <div className={cn('flex flex-col gap-3', columnClassName)}>
            <BracketTree columnClassName="min-w-0 flex-1" picking={picking} rounds={[{ ...finalRound, games: [final] }]} showHeaders />
            {champion ? <BracketChampionCard champion={champion} isOwnEntry={isOwnEntry} /> : null}
          </div>
        ) : null}
        {right.length > 0 ? <BracketTree columnClassName={columnClassName} isMirrored picking={picking} rounds={right} showHeaders /> : null}
      </div>
      {tiebreaker ? <Text as="div" data-testid="bracket-view-tiebreaker" size="sm" variant="meta">{tiebreaker}</Text> : null}
    </div>
  );
}

