import {
  DetailEditModal,
  formatDateTimeDisplay,
  LinkButton,
  useDisplayPreferences,
  type DetailAction,
  type Fact,
} from '@/features/shared/ui';
import type { SportEventContestDto } from '@/lib/api';
import { CONTEST_STATUS_LABELS } from '@/features/contests/contest-status';
import { buildLeagueContestPath } from '@/features/leagues/league-routing';
import { CUSTOMER_LEAGUE_PARAM, CUSTOMER_LEAGUES_PATH } from './manage-navigation';
import { NO_TEMPLATE } from './event-contest-columns';

/**
 * A contest on the Event page's Contests grid (⤢): what it is, then where to go from it. Nothing
 * about a customer's contest is changed from here, so it has no Edit.
 */
export function EventContestDialog({ contest, onClose }: { contest: SportEventContestDto; onClose: () => void }) {
  const preferences = useDisplayPreferences();
  const testId = 'root-admin-event-contest-dialog';
  const facts: Fact[] = [
    { id: 'name', label: 'Contest', value: contest.name, testId: `${testId}-name` },
    { id: 'league', label: 'League', value: contest.leagueName, testId: `${testId}-league` },
    { id: 'template', label: 'Contest template', value: contest.contestTemplateName ?? NO_TEMPLATE, testId: `${testId}-template` },
    { id: 'status', label: 'Status', value: CONTEST_STATUS_LABELS[contest.status], testId: `${testId}-status` },
    { id: 'entries', label: 'Entries', value: String(contest.entryCount), testId: `${testId}-entries` },
    { id: 'created', label: 'Created', value: formatDateTimeDisplay(contest.createdAt, preferences) },
  ];
  const actions: DetailAction[] = [
    {
      id: 'open-contest',
      name: 'Open contest',
      description: 'Its page in its league, as members see it.',
      control: <LinkButton data-testid={`${testId}-open-contest`} size="sm" to={buildLeagueContestPath(contest.leagueCode, contest.id)} variant="secondary">Open contest ›</LinkButton>,
    },
    {
      id: 'open-league',
      name: 'Open league',
      description: 'The league in Customers, with its plan and members.',
      control: (
        <LinkButton
          data-testid={`${testId}-open-league`}
          size="sm"
          to={`${CUSTOMER_LEAGUES_PATH}?${CUSTOMER_LEAGUE_PARAM}=${contest.leagueId}`}
          variant="secondary"
        >
          Open league ›
        </LinkButton>
      ),
    },
  ];

  return (
    <DetailEditModal
      actions={actions}
      facts={facts}
      mode="view"
      onCancel={onClose}
      onOpenChange={(open) => (open ? undefined : onClose())}
      open
      testId={testId}
      title={contest.name}
    />
  );
}
