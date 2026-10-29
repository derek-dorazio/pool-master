import { Award } from 'lucide-react';
import { ErrorState, Heading, Tile } from '@/features/shared/ui';
import { describePlateWinners, describeWonPlate, perpetualTrophyName, type WonPlate } from './perpetual-trophy-view';
import { usePerpetualTrophiesQuery } from './use-championship-query';

/**
 * Perpetual trophies on the Trophy case (#874): one per contest the league runs every year, with
 * a plate per year naming its winners. Nothing shows until a contest has run in two years.
 */
export function PerpetualTrophies({ leagueId }: { leagueId: string }) {
  const trophiesQuery = usePerpetualTrophiesQuery(leagueId);

  if (trophiesQuery.isError) {
    return <ErrorState body="We couldn't load the perpetual trophies." testId="perpetual-trophies-error" />;
  }
  const trophies = trophiesQuery.data ?? [];
  if (!trophies.length) {
    return null;
  }

  return (
    <section className="space-y-3" data-testid="perpetual-trophies">
      <Heading level={2} variant="subtitle">Perpetual trophies</Heading>
      {trophies.map((trophy) => (
        <Tile className="space-y-2" data-testid={`perpetual-trophy-${trophy.eventSeriesId}-${trophy.selectionType}`} key={`${trophy.eventSeriesId}-${trophy.selectionType}`} padding="sm" radius="lg">
          <Heading level={3} variant="card" className="flex items-center gap-2">
            <Award aria-hidden className="text-primary" size={18} />
            {perpetualTrophyName(trophy)}
          </Heading>
          <p className="text-xs text-muted-foreground">{trophy.sportLeagueName}</p>
          <ul className="space-y-1 text-sm">
            {trophy.plates.map((plate) => (
              <li className="flex flex-wrap justify-between gap-2" data-testid={`perpetual-plate-${plate.contestId}`} key={plate.contestId}>
                <span className="font-medium text-foreground">{plate.year}</span>
                <span className={plate.winners.length ? 'text-foreground' : 'text-muted-foreground'}>{describePlateWinners(plate)}</span>
              </li>
            ))}
          </ul>
        </Tile>
      ))}
    </section>
  );
}

/** The perpetual trophy plates a squad's name is on, in its trophy case (#874). */
export function SquadPerpetualPlates({ plates }: { plates: WonPlate[] }) {
  if (!plates.length) {
    return null;
  }

  return (
    <ul className="space-y-1 text-sm" data-testid="squad-history-plates">
      {plates.map((won) => (
        <li className="inline-flex w-full items-center gap-2 text-foreground" data-testid={`squad-history-plate-${won.plate.contestId}`} key={won.plate.contestId}>
          <Award aria-hidden className="text-muted-foreground" size={16} />
          {describeWonPlate(won)}
        </li>
      ))}
    </ul>
  );
}
