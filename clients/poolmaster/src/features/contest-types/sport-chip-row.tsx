import { ChoiceChips } from '@/features/shared/ui';
import { sportLeagueChoiceLabel, sportLeagueChoiceSearch, sportSlug, type FilterableSport, type SportLeagueChoice } from './sport-league-choice';

/**
 * The sport switch on a phone (#1701): every sport on one scrolling row of chips. A chosen league
 * or round (picked in the "Every league you can run" card) stands in its sport's place as one
 * chip, "NHL · Stanley Cup Final", whose × goes back to the sport.
 */
export function SportChipRow({ choice, className, onPick, sports, testId }: {
  choice: Pick<SportLeagueChoice<FilterableSport>, 'sport' | 'league' | 'partSlug'>;
  className?: string;
  onPick?: () => void;
  sports: readonly FilterableSport[];
  testId: string;
}) {
  const label = sportLeagueChoiceLabel(choice);
  return (
    <div className={className}>
      <ChoiceChips
        aria-label="Sport"
        clearable={choice.sport && label ? { label, replaces: sportLeagueChoiceSearch(choice.sport.sport), testId: `${testId}-clear` } : undefined}
        items={[
          { isChosen: choice.sport === null, label: 'All sports', onClick: onPick, testId: `${testId}-all`, to: '?' },
          ...sports.map(({ sport, name }) => ({
            isChosen: choice.sport?.sport === sport,
            label: name,
            onClick: onPick,
            testId: `${testId}-${sportSlug(sport)}`,
            to: sportLeagueChoiceSearch(sport),
          })),
        ]}
        testId={testId}
      />
    </div>
  );
}
