import { QueryState } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { useLeaguePage } from './league-page-context';
import { LeagueStructureConferencesSection } from './league-structure-conferences-section';
import { LeagueStructurePhasesSection } from './league-structure-phases-section';
import { LeagueStructurePositionsSection } from './league-structure-positions-section';
import { slotRowsOf } from './league-structure-rows';
import { LeagueStructureSlotsSection } from './league-structure-slots-section';
import { LeagueStructureSeasonSlotsSection, LeagueStructureSeasonsSection } from './league-structure-seasons-section';
import { useSportLeagueSeasonsQuery } from '@/features/contests/use-sport-league-seasons';
import { useSportLeagueConferencesQuery, useSportLeaguePositionsQuery, useSportLeagueStructureQuery } from './use-sport-league-page';

/**
 * The League page's Structure tab (#2002, plans/league-model-redesign.md §9d): the league's
 * phases and slot definitions with their provider mappings, its playing positions with their
 * provider codes (#2001), its conferences with their divisions (#2052), then its Seasons and
 * their slots (#2003), read only, since migrations own them.
 */
export function LeagueStructureTab() {
  const { sportLeague } = useLeaguePage();
  const structureQuery = useSportLeagueStructureQuery(sportLeague.id);
  const positionsQuery = useSportLeaguePositionsQuery(sportLeague.id);
  const conferencesQuery = useSportLeagueConferencesQuery(sportLeague.id);
  const seasonsQuery = useSportLeagueSeasonsQuery(sportLeague.id);

  return (
    <div className="space-y-6">
      <QueryState
        error={extractErrorMessage(structureQuery.error, { fallback: 'We could not load the league\'s structure right now.' })}
        loading="Loading the league's structure..."
        query={structureQuery}
        testId="root-admin-league-structure-state"
      >
        {(phases) => (
          <div className="space-y-6" data-testid="root-admin-league-structure">
            <LeagueStructurePhasesSection phases={phases} />
            <LeagueStructureSlotsSection slots={slotRowsOf(phases)} />
          </div>
        )}
      </QueryState>
      <QueryState
        error={extractErrorMessage(positionsQuery.error, { fallback: 'We could not load the league\'s positions right now.' })}
        loading="Loading the league's positions..."
        query={positionsQuery}
        testId="root-admin-league-structure-positions-state"
      >
        {(positions) => <LeagueStructurePositionsSection positions={positions} />}
      </QueryState>
      <QueryState
        error={extractErrorMessage(conferencesQuery.error, { fallback: 'We could not load the league\'s conferences right now.' })}
        loading="Loading the league's conferences..."
        query={conferencesQuery}
        testId="root-admin-league-structure-conferences-state"
      >
        {(conferences) => <LeagueStructureConferencesSection conferences={conferences} />}
      </QueryState>
      <QueryState
        error={extractErrorMessage(seasonsQuery.error, { fallback: 'We could not load the league\'s Seasons right now.' })}
        loading="Loading the league's Seasons..."
        query={seasonsQuery}
        testId="root-admin-league-structure-seasons-state"
      >
        {(seasons) => (
          <div className="space-y-6" data-testid="root-admin-league-seasons">
            <LeagueStructureSeasonsSection seasons={seasons} timeZone={sportLeague.timeZone} />
            <LeagueStructureSeasonSlotsSection seasons={seasons} />
          </div>
        )}
      </QueryState>
    </div>
  );
}
