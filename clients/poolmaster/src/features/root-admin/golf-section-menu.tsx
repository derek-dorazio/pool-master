import { useNavigate } from 'react-router-dom';
import { SegmentedControl } from '@/features/shared/ui';
import { GOLF_PLAYER_LIST_PATH, GOLF_TOUR_LIST_PATH, GOLF_TOURNAMENT_LIST_PATH } from './manage-navigation';

const GOLF_LISTS = ['tournaments', 'players', 'tours'] as const;

type GolfList = (typeof GOLF_LISTS)[number];

const GOLF_LIST_LABELS: Record<GolfList, string> = {
  tournaments: 'Tournaments',
  players: 'Players',
  tours: 'Tours',
};

const GOLF_LIST_PATHS: Record<GolfList, string> = {
  tournaments: GOLF_TOURNAMENT_LIST_PATH,
  players: GOLF_PLAYER_LIST_PATH,
  tours: GOLF_TOUR_LIST_PATH,
};

/** Moves between the Golf section's three lists; the side menu has one Golf entry. */
export function GolfSectionMenu({ current }: { current: GolfList }) {
  const navigate = useNavigate();

  return (
    <nav aria-label="Golf lists" data-testid="root-admin-golf-menu">
      <SegmentedControl
        aria-label="Golf list"
        onChange={(next) => {
          const list = GOLF_LISTS.find((candidate) => candidate === next);
          if (list) {
            navigate(GOLF_LIST_PATHS[list]);
          }
        }}
        options={GOLF_LISTS.map((list) => ({
          label: GOLF_LIST_LABELS[list],
          testId: `root-admin-golf-menu-${list}`,
          value: list,
        }))}
        value={current}
      />
    </nav>
  );
}
