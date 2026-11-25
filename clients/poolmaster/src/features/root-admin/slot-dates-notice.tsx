import { LinkButton, Notice } from '@/features/shared/ui';
import { useSportLeagueSeasonsQuery } from '@/features/contests/use-sport-league-seasons';
import { seasonsNeedingDatesText } from './league-structure-rows';

/**
 * The League page's banner for slots that need dates (#1924): a slot its provider places by date
 * window with no window, or only a tentative one, in a Season the sync reads. The API decides
 * which slots need dates; this only counts them per Season, and goes away once none do.
 */
export function SlotDatesNotice({ sportLeagueId, structurePath }: { sportLeagueId: string; structurePath: string }) {
  const seasonsQuery = useSportLeagueSeasonsQuery(sportLeagueId);
  const text = seasonsNeedingDatesText(seasonsQuery.data ?? []);
  if (text === null) return null;
  return (
    <Notice
      action={(
        <LinkButton data-testid="root-admin-league-slot-dates-open" size="sm" to={structurePath} variant="secondary">
          Open Season slots
        </LinkButton>
      )}
      data-testid="root-admin-league-slot-dates-notice"
      title="Slots need dates"
      tone="warning"
    >
      {`The sync places a game only inside its slot's dates, and these Seasons have slots with no dates or only tentative ones: ${text}.`}
    </Notice>
  );
}
