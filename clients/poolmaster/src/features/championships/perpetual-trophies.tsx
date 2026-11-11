import { Award } from 'lucide-react';
import { ErrorState, SectionCard, SectionRow, SectionRows } from '@/features/shared/ui';
import { describePlateWinners, describeWonPlate, perpetualTrophyName, type WonPlate } from './perpetual-trophy-view';
import { usePerpetualTrophiesQuery } from './use-championship-query';

/**
 * Perpetual trophies on the Trophy case (#874): one per contest the league runs every year, with
 * a plate per year naming its winners. Nothing shows until a contest has run in two years.
 */
export function PerpetualTrophies({ leagueId }: { leagueId: string }) {
  const trophiesQuery = usePerpetualTrophiesQuery(leagueId);

  if (trophiesQuery.isError) {
    return <ErrorState body="We couldn't load the perpetual trophies." onRetry={() => void trophiesQuery.refetch()} testId="perpetual-trophies-error" />;
  }
  const trophies = trophiesQuery.data ?? [];
  if (!trophies.length) {
    return null;
  }

  return (
    <SectionCard bare testId="perpetual-trophies" title="Perpetual trophies">
      {trophies.map((trophy) => (
        <SectionCard
          headingLevel={3}
          key={`${trophy.eventSeriesId}-${trophy.selectionType}`}
          testId={`perpetual-trophy-${trophy.eventSeriesId}-${trophy.selectionType}`}
          title={(
            <>
              <Award aria-hidden className="text-primary" size={18} />
              {perpetualTrophyName(trophy)}
            </>
          )}
          trailing={trophy.sportLeagueName}
        >
          <SectionRows>
            {trophy.plates.map((plate) => (
              <SectionRow
                facts={describePlateWinners(plate)}
                key={plate.contestId}
                name={plate.year}
                testId={`perpetual-plate-${plate.contestId}`}
              />
            ))}
          </SectionRows>
        </SectionCard>
      ))}
    </SectionCard>
  );
}

/** The perpetual trophy plates a squad's name is on, as rows of its trophy case (#874). */
export function SquadPerpetualPlates({ plates }: { plates: WonPlate[] }) {
  return plates.map((won) => (
    <SectionRow
      key={won.plate.contestId}
      name={(
        <>
          <Award aria-hidden className="mr-2 inline text-muted-foreground" size={16} />
          {describeWonPlate(won)}
        </>
      )}
      testId={`squad-history-plate-${won.plate.contestId}`}
    />
  ));
}
