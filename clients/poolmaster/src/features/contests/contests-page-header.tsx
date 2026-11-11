import type { ReactNode } from 'react';
import { LinkButton, PageHeader, PageTabs } from '@/features/shared/ui';
import { buildLeagueContestHistoryPath, buildLeagueContestsPath } from '@/features/leagues/league-routing';
import { HOW_TO_PLAY_PATH } from '@/features/event-pages/event-page-paths';

export type ContestsView = 'current' | 'past';

/**
 * The Contests page's heading, the same on both tabs (#1390, #1542): its title, a How to play
 * link, and Current and Past as tabs on its bottom line. Past puts its year at the tab row's end.
 */
export function ContestsPageHeader({
  leagueCode,
  tabsEnd,
  view,
}: {
  leagueCode: string;
  tabsEnd?: ReactNode;
  view: ContestsView;
}) {
  return (
    <PageHeader
      actions={(
        <LinkButton data-testid="contests-how-to-play" size="sm" to={HOW_TO_PLAY_PATH} variant="subtle">
          How to play
        </LinkButton>
      )}
      tabs={(
        <PageTabs
          aria-label="Contests to show"
          items={[
            { isActive: view === 'current', label: 'Current', testId: 'contests-view-current', to: buildLeagueContestsPath(leagueCode) },
            { isActive: view === 'past', label: 'Past', testId: 'contests-view-past', to: buildLeagueContestHistoryPath(leagueCode) },
          ]}
          variant="link"
        />
      )}
      tabsEnd={tabsEnd}
      testId="contests-page-header"
      title="Contests"
    />
  );
}
