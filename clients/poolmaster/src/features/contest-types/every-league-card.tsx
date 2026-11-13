import { ChoiceChips, Heading, SectionBody, SectionCard } from '@/features/shared/ui';
import { sportLeagueChoiceSearch, sportSlug, type FilterableSport } from './sport-league-choice';

/**
 * Every sport's leagues and playoff rounds as chips, on a phone below what they narrow (#1701):
 * the full list of what can be run, each chip a link that picks that league or round. `onPick`
 * runs as one is followed, to scroll back up to what it narrows.
 */
export function EveryLeagueCard({ className, onPick, sports, testId }: {
  className?: string;
  onPick?: () => void;
  sports: readonly FilterableSport[];
  testId: string;
}) {
  return (
    <div className={className}>
      <SectionCard testId={testId} title="Every league you can run">
        <SectionBody>
          <div className="space-y-4">
            {sports.map(({ sport, name, leagues }) => (
              <div className="space-y-2" key={sport}>
                <Heading level={3} variant="eyebrow">{name}</Heading>
                <ChoiceChips
                  aria-label={`${name} leagues`}
                  items={leagues.flatMap((league) => [
                    { isChosen: false, label: league.name, onClick: onPick, testId: `${testId}-${sportSlug(sport)}-${league.slug}`, to: sportLeagueChoiceSearch(sport, league.slug) },
                    ...league.rounds.map((round) => ({
                      isChosen: false,
                      label: round.name,
                      onClick: onPick,
                      testId: `${testId}-${sportSlug(sport)}-${league.slug}-${round.slug}`,
                      to: sportLeagueChoiceSearch(sport, league.slug, round.slug),
                    })),
                  ])}
                  layout="wrap"
                />
              </div>
            ))}
          </div>
        </SectionBody>
      </SectionCard>
    </div>
  );
}
