import { useNavigate } from 'react-router-dom';
import { SegmentedControl } from '@/features/shared/ui';
import {
  buildLeagueContestHistoryPath,
  buildLeagueContestsPath,
  buildLeagueMyContestsPath,
} from '@/features/leagues/league-routing';

export type ContestsView = 'active' | 'history' | 'mine';

/** The Contests page's views: every active contest, the ones your team entered, and history. */
export function ContestsViewSwitch({ leagueCode, value }: { leagueCode: string; value: ContestsView }) {
  const navigate = useNavigate();
  const paths: Record<ContestsView, string> = {
    active: buildLeagueContestsPath(leagueCode),
    mine: buildLeagueMyContestsPath(leagueCode),
    history: buildLeagueContestHistoryPath(leagueCode),
  };

  return (
    <SegmentedControl
      aria-label="Contests to show"
      onChange={(next) => navigate(paths[next as ContestsView])}
      options={[
        { label: 'Active', testId: 'contests-view-active', value: 'active' },
        { label: 'My contests', testId: 'contests-view-mine', value: 'mine' },
        { label: 'History', testId: 'contests-view-history', value: 'history' },
      ]}
      value={value}
    />
  );
}
