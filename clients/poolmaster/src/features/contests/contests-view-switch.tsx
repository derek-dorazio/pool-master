import { useNavigate } from 'react-router';
import { LinkButton, PageHeader, SegmentedControl } from '@/features/shared/ui';
import { buildLeagueContestHistoryPath, buildLeagueContestsPath } from '@/features/leagues/league-routing';
import { HOW_TO_PLAY_PATH } from '@/features/event-pages/event-page-paths';

export type ContestsView = 'current' | 'past';

/** The Contests page's two tabs (#1390): the current contests (live, open, drafts) and past ones. */
function ContestsViewSwitch({ leagueCode, value }: { leagueCode: string; value: ContestsView }) {
  const navigate = useNavigate();
  const paths: Record<ContestsView, string> = {
    current: buildLeagueContestsPath(leagueCode),
    past: buildLeagueContestHistoryPath(leagueCode),
  };

  return (
    <SegmentedControl
      aria-label="Contests to show"
      onChange={(next) => void navigate(paths[next as ContestsView])}
      options={[
        { label: 'Current', testId: 'contests-view-current', value: 'current' },
        { label: 'Past', testId: 'contests-view-past', value: 'past' },
      ]}
      value={value}
    />
  );
}

/** The Contests page's heading, the same on both tabs: its title, a How to play link, then the tabs. */
export function ContestsPageHeader({
  description,
  leagueCode,
  view,
}: {
  description: string;
  leagueCode: string;
  view: ContestsView;
}) {
  return (
    <>
      <PageHeader
        actions={(
          <LinkButton data-testid="contests-how-to-play" size="sm" to={HOW_TO_PLAY_PATH} variant="subtle">
            How to play
          </LinkButton>
        )}
        description={description}
        title="Contests"
      />
      <ContestsViewSwitch leagueCode={leagueCode} value={view} />
    </>
  );
}
