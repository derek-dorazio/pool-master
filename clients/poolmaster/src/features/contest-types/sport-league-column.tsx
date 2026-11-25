import { ChoiceList, type ChoiceListItem } from '@/features/shared/ui';
import { sportLeagueChoiceSearch, type FilterableSport, type SportLeagueChoice } from './sport-league-choice';

/** With every sport shown, how many of a sport's leagues the column lists before "+ N more". */
const LINES_PER_SPORT = 4;

/**
 * The column's lines: every sport, then each sport with its count of contest types. The chosen sport opens to its
 * leagues (#1701); with every sport shown, each sport lists its first leagues and "+ N more".
 */
function sportLeagueColumnItems(
  sports: readonly FilterableSport[],
  choice: Pick<SportLeagueChoice<FilterableSport>, 'sport' | 'league'>,
  testId: string,
  onPick?: () => void,
): ChoiceListItem[] {
  const all: ChoiceListItem = { isChosen: choice.sport === null, label: 'All sports', onClick: onPick, testId: `${testId}-all`, to: '?', tone: 'heading' };
  return [all, ...sports.flatMap(({ sport, urlSegment, name, leagues, count }) => {
    const isOpen = choice.sport?.sport === sport;
    const heading: ChoiceListItem = {
      count,
      isChosen: isOpen && choice.league === null,
      label: name,
      onClick: onPick,
      testId: `${testId}-${urlSegment}`,
      to: sportLeagueChoiceSearch(urlSegment),
      tone: 'heading',
    };
    if (choice.sport !== null && !isOpen) {
      return [heading];
    }
    const lines = leagues.map((league): ChoiceListItem => ({
      depth: 1,
      isChosen: isOpen && choice.league?.urlSegment === league.urlSegment,
      label: league.name,
      onClick: onPick,
      testId: `${testId}-${urlSegment}-${league.urlSegment}`,
      to: sportLeagueChoiceSearch(urlSegment, league.urlSegment),
    }));
    if (isOpen || lines.length <= LINES_PER_SPORT) {
      return [heading, ...lines];
    }
    const shown = lines.slice(0, LINES_PER_SPORT);
    const more = lines.length - shown.length;
    const moreLine: ChoiceListItem = { depth: 1, isChosen: false, label: `+ ${more} more`, onClick: onPick, testId: `${testId}-${urlSegment}-more`, to: sportLeagueChoiceSearch(urlSegment), tone: 'muted' };
    return [heading, ...shown, moreLine];
  })];
}

/**
 * Every sport and league down the side of a computer screen (#1701), beside what it narrows and
 * kept in view as the page scrolls. Choosing one keeps it in the page's link.
 */
export function SportLeagueColumn({ choice, className, onPick, sports, testId }: {
  choice: Pick<SportLeagueChoice<FilterableSport>, 'sport' | 'league'>;
  className?: string;
  onPick?: () => void;
  sports: readonly FilterableSport[];
  testId: string;
}) {
  return <ChoiceList aria-label="Sports and leagues" className={className} items={sportLeagueColumnItems(sports, choice, testId, onPick)} testId={testId} />;
}
