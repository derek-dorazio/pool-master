import type { Sport } from '@poolmaster/shared/domain';
import { FilterPicker } from '@/features/shared/ui';
import { sportSlug, type FilterableSport } from './sport-league-choice';

/**
 * The one sport switch (#1580), in the page header's filter slot on both How to Play and Contest
 * types: every sport, then each sport with its leagues under it, the sport first to choose every
 * league of it.
 */
export function SportLeagueFilter({ leagueSlug, onChoose, sport, sports, testId }: {
  leagueSlug: string | null;
  onChoose: (sport: Sport | null, league?: string) => void;
  sport: Sport | null;
  sports: readonly FilterableSport[];
  testId: string;
}) {
  const value = sport ? [sportSlug(sport), leagueSlug].filter(Boolean).join('/') : '';
  return (
    <FilterPicker
      label="Sport"
      onChange={(chosen) => {
        const [slug, league] = chosen.split('/');
        onChoose(sports.find((candidate) => sportSlug(candidate.sport) === slug)?.sport ?? null, league);
      }}
      options={[
        { label: 'All sports', value: '' },
        ...sports.map(({ sport: each, name, leagues }) => ({
          label: name,
          options: [
            { label: `All ${name.toLowerCase()}`, value: sportSlug(each) },
            ...leagues.map((league) => ({ label: league.name, value: `${sportSlug(each)}/${league.slug}` })),
          ],
        })),
      ]}
      testId={testId}
      value={value}
    />
  );
}
