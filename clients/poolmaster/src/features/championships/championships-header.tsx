import { championshipYear } from '@poolmaster/shared/domain';
import { useId } from 'react';
import { buildLeagueHistoryPath } from '@/features/leagues/league-routing';
import { PageHeader, PageTabs, Select } from '@/features/shared/ui';
import { type ChampionshipsYearTab, championshipsYearTabPaths } from './championship-year';

type SeasonPicker = {
  onChange: (year: number) => void;
  /** The years offered, newest first; the one being read is among them. */
  years: number[];
};

type ChampionshipsHeaderProps = {
  leagueCode: string;
  title: string;
} & (
  /** A year-based tab, with the season picker alone at the tab row's right end. */
  | { tab: ChampionshipsYearTab; year: number; season: SeasonPicker }
  /** All years, where a season means nothing: no picker, and the other tabs open the current year. */
  | { tab: 'allYears'; year?: never; season?: never }
);

/**
 * The one header over every Championships view (#1543): the title, then Championship, Trophy
 * case, Points race and All years as `PageTabs` (rules/ux-rules.md §12 rule 3). All years keeps
 * its own address, so each tab is a link.
 */
export function ChampionshipsHeader(props: ChampionshipsHeaderProps) {
  const { leagueCode, tab, title } = props;
  const seasonId = useId();
  const paths = championshipsYearTabPaths(leagueCode, props.year ?? championshipYear(new Date()));
  const items = [
    { label: 'Championship', testId: 'championships-tab-championship', to: paths.championship, isActive: tab === 'championship' },
    { label: 'Trophy case', testId: 'championships-tab-trophies', to: paths.trophies, isActive: tab === 'trophies' },
    { label: 'Points race', testId: 'championships-tab-race', to: paths.race, isActive: tab === 'race' },
    { label: 'All years', testId: 'championships-tab-all-years', to: buildLeagueHistoryPath(leagueCode), isActive: tab === 'allYears' },
  ];

  return (
    <PageHeader
      tabs={<PageTabs aria-label="Championship views" items={items} variant="link" />}
      tabsEnd={props.season ? (
        <>
          <label htmlFor={seasonId}>Season</label>
          <Select
            className="w-auto"
            data-testid="championships-year"
            id={seasonId}
            onChange={(event) => props.season.onChange(Number(event.target.value))}
            value={props.year}
          >
            {props.season.years.map((option) => <option key={option} value={option}>{option}</option>)}
          </Select>
        </>
      ) : undefined}
      testId="championships-header"
      title={title}
    />
  );
}
