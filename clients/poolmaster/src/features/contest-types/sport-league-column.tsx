import { ChoiceList, type ChoiceListItem } from '@/features/shared/ui';
import { REGULAR_SEASON, sportLeagueChoiceSearch, sportLeagueCount, sportSlug, type FilterableSport, type SportLeagueChoice } from './sport-league-choice';

/** With every sport shown, how many of a sport's leagues and rounds the column lists before "+ N more". */
const LINES_PER_SPORT = 4;

/**
 * The column's lines: every sport, then each sport with its count. The chosen sport opens to its
 * leagues, each with its regular season and its playoff rounds under it (#1701); with every sport
 * shown, each sport lists its first leagues and rounds and "+ N more".
 */
function sportLeagueColumnItems(
  sports: readonly FilterableSport[],
  choice: Pick<SportLeagueChoice<FilterableSport>, 'sport' | 'league' | 'partSlug'>,
  testId: string,
  onPick?: () => void,
): ChoiceListItem[] {
  const all: ChoiceListItem = { isChosen: choice.sport === null, label: 'All sports', onClick: onPick, testId: `${testId}-all`, to: '?', tone: 'heading' };
  return [all, ...sports.flatMap(({ sport, name, leagues }, index) => {
    const slug = sportSlug(sport);
    const isOpen = choice.sport?.sport === sport;
    const heading: ChoiceListItem = {
      count: sportLeagueCount(sports[index]),
      isChosen: isOpen && choice.league === null,
      label: name,
      onClick: onPick,
      testId: `${testId}-${slug}`,
      to: sportLeagueChoiceSearch(sport),
      tone: 'heading',
    };
    if (choice.sport !== null && !isOpen) {
      return [heading];
    }
    const lines = leagues.flatMap((league): ChoiceListItem[] => {
      const leagueLine: ChoiceListItem = {
        depth: 1,
        isChosen: isOpen && choice.league?.slug === league.slug && choice.partSlug === null,
        label: league.name,
        onClick: onPick,
        testId: `${testId}-${slug}-${league.slug}`,
        to: sportLeagueChoiceSearch(sport, league.slug),
      };
      if (league.rounds.length === 0) {
        return [leagueLine];
      }
      const part = (partSlug: string, label: string): ChoiceListItem => ({
        depth: 2,
        isChosen: isOpen && choice.league?.slug === league.slug && choice.partSlug === partSlug,
        label,
        onClick: onPick,
        testId: `${testId}-${slug}-${league.slug}-${partSlug}`,
        to: sportLeagueChoiceSearch(sport, league.slug, partSlug),
      });
      // With every sport shown, a league's regular season is left to its own line.
      const season = isOpen ? [part(league.slug, REGULAR_SEASON)] : [];
      return [leagueLine, ...season, ...league.rounds.map((round) => part(round.slug, round.name))];
    });
    if (isOpen || lines.length <= LINES_PER_SPORT) {
      return [heading, ...lines];
    }
    const shown = lines.slice(0, LINES_PER_SPORT);
    const more = lines.length - shown.length;
    const moreLine: ChoiceListItem = { depth: 1, isChosen: false, label: `+ ${more} more`, onClick: onPick, testId: `${testId}-${slug}-more`, to: sportLeagueChoiceSearch(sport), tone: 'muted' };
    return [heading, ...shown, moreLine];
  })];
}

/**
 * Every sport and league down the side of a computer screen (#1701), beside what it narrows and
 * kept in view as the page scrolls. Choosing one keeps it in the page's link.
 */
export function SportLeagueColumn({ choice, className, onPick, sports, testId }: {
  choice: Pick<SportLeagueChoice<FilterableSport>, 'sport' | 'league' | 'partSlug'>;
  className?: string;
  onPick?: () => void;
  sports: readonly FilterableSport[];
  testId: string;
}) {
  return <ChoiceList aria-label="Sports and leagues" className={className} items={sportLeagueColumnItems(sports, choice, testId, onPick)} testId={testId} />;
}
