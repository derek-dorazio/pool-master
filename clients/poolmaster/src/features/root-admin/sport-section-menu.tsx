import { PageTabs } from '@/features/shared/ui';
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
 * Moves between a sport's three lists, named in its own words (golf: Tournaments, Golfers,
 * Tours); the side menu has one entry per sport.
 */
export function SportSectionMenu({ current }: { current: SportList }) {
  const { sport, definition } = useManagedSport();
  const { event, participant, sportLeague } = definition.vocabulary;
  const lists: Record<SportList, { label: string; path: string }> = {
    events: { label: capitalize(event.many), path: buildSportEventListPath(sport) },
    participants: { label: capitalize(participant.many), path: buildSportParticipantListPath(sport) },
    leagues: { label: capitalize(sportLeague.many), path: buildSportLeagueListPath(sport) },
  };

  // The area's own PageHeader titles the sport; these tabs sit on a ruled line under it.
  return (
    <div className="border-b border-border" data-testid="root-admin-sport-menu">
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
    </div>
  );
}
