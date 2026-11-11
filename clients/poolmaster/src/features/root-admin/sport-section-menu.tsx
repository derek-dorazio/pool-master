import { PageHeader, PageTabs } from '@/features/shared/ui';
import { useManagePageOwnsHeading } from './manage-breadcrumb-context';
import {
  buildSportEventListPath,
  buildSportLeagueListPath,
  buildSportParticipantListPath,
  capitalize,
} from './manage-navigation';
import { useManagedSport } from './use-managed-sport';

const SPORT_LISTS = ['events', 'participants', 'leagues'] as const;

type SportList = (typeof SPORT_LISTS)[number];

/**
 * The header of a sport's three lists: the sport's name as the title and tabs between the lists,
 * named in its own words (golf: Tournaments, Golfers, Tours), so no list's name shows twice. The
 * side menu has one entry per sport; the area keeps only its trail above it.
 */
export function SportSectionMenu({ current }: { current: SportList }) {
  useManagePageOwnsHeading();
  const { sport, definition } = useManagedSport();
  const { event, participant, sportLeague } = definition.vocabulary;
  const lists: Record<SportList, { label: string; path: string }> = {
    events: { label: capitalize(event.many), path: buildSportEventListPath(sport) },
    participants: { label: capitalize(participant.many), path: buildSportParticipantListPath(sport) },
    leagues: { label: capitalize(sportLeague.many), path: buildSportLeagueListPath(sport) },
  };

  return (
    <PageHeader
      tabs={(
        <PageTabs
          aria-label={`${definition.name} lists`}
          items={SPORT_LISTS.map((list) => ({
            isActive: list === current,
            label: lists[list].label,
            testId: `root-admin-sport-menu-${list}`,
            to: lists[list].path,
          }))}
          variant="link"
        />
      )}
      testId="root-admin-sport-menu"
      title={definition.name}
    />
  );
}
