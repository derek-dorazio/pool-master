import { useNavigate } from 'react-router-dom';
import { SegmentedControl } from '@/features/shared/ui';
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
export function GolfSectionMenu({ current }: { current: SportList }) {
  const navigate = useNavigate();
  const { sport, definition } = useManagedSport();
  const { event, participant, sportLeague } = definition.vocabulary;
  const lists: Record<SportList, { label: string; path: string }> = {
    events: { label: capitalize(event.many), path: buildSportEventListPath(sport) },
    participants: { label: capitalize(participant.many), path: buildSportParticipantListPath(sport) },
    leagues: { label: capitalize(sportLeague.many), path: buildSportLeagueListPath(sport) },
  };

  return (
    <nav aria-label={`${definition.name} lists`} data-testid="root-admin-golf-menu">
      <SegmentedControl
        aria-label={`${definition.name} list`}
        onChange={(next) => {
          const list = SPORT_LISTS.find((candidate) => candidate === next);
          if (list) {
            navigate(lists[list].path);
          }
        }}
        options={SPORT_LISTS.map((list) => ({
          label: lists[list].label,
          testId: `root-admin-golf-menu-${list}`,
          value: list,
        }))}
        value={current}
      />
    </nav>
  );
}
