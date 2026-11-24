import { QueryState } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { useLeaguePage } from './league-page-context';
import { LeagueStructurePhasesSection } from './league-structure-phases-section';
import { slotRowsOf } from './league-structure-rows';
import { LeagueStructureSlotsSection } from './league-structure-slots-section';
import { useSportLeagueStructureQuery } from './use-sport-league-page';

/**
 * The League page's Structure tab (#2002, plans/league-model-redesign.md §9d): the league's
 * phases and slot definitions with their provider mappings, read only, since migrations own
 * them. Later slices add Seasons, positions, conferences and divisions as sections of their own.
 */
export function LeagueStructureTab() {
  const { sportLeague } = useLeaguePage();
  const structureQuery = useSportLeagueStructureQuery(sportLeague.id);

  return (
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
  );
}
