import { enumLabel } from '@poolmaster/shared/display-strings';
import { assertNever, type Sport } from '@poolmaster/shared/domain';
import {
  Button,
  Chip,
  formatDateTimeDisplay,
  DetailsPeek,
  SectionRow,
  SectionRows,
  Text,
  useDisplayPreferences,
} from '@/features/shared/ui';
import type { SportLeagueOverviewDto } from '@/lib/api';
import { buildSportEventPath } from './manage-navigation';
import { buildLeagueOpenFindingsPath } from './sync-findings-links';
import { overdueLateness, RELEASE_CHECK_LABELS, syncFailedText } from './sport-league-overview-text';

import type { SportLeagueIssue } from './sport-league-overview-text';

/**
 * One sport league's Issues cell: a short chip per issue type with its count, in the fixed order
 * the read gives (Findings, Sync, Release, Overdue). Hovering a chip lists the items behind the
 * count, each leading to its fix: a severity's open findings open Findings filtered to them, a
 * failed sync opens its run, a held release opens its event.
 */
export function SportLeagueIssueChips({
  onOpenSyncRun,
  overview,
}: {
  onOpenSyncRun: (syncRunId: string) => void;
  overview: Pick<SportLeagueOverviewDto, 'id' | 'issues' | 'name' | 'sport'>;
}) {
  if (overview.issues.length === 0) {
    return <Text tone="muted">—</Text>;
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {overview.issues.map((issue) => (
        <DetailsPeek
          icon={(
            <Chip data-testid={`root-admin-sports-issue-${overview.id}-${issue.type}`} tone="danger">
              {`${enumLabel('SportLeagueIssueType', issue.type)} ${String(issue.count)}`}
            </Chip>
          )}
          key={issue.type}
          label={`${overview.name}: ${enumLabel('SportLeagueIssueType', issue.type)} issues`}
          testId={`root-admin-sports-issue-${overview.id}-${issue.type}-popover`}
          trigger="cell"
        >
          <IssueItems issue={issue} onOpenSyncRun={onOpenSyncRun} sport={overview.sport} sportLeagueName={overview.name} />
        </DetailsPeek>
      ))}
    </span>
  );
}

function IssueItems({ issue, onOpenSyncRun, sport, sportLeagueName }: {
  issue: SportLeagueIssue;
  onOpenSyncRun: (syncRunId: string) => void;
  sport: Sport;
  sportLeagueName: string;
}) {
  const displayPreferences = useDisplayPreferences();
  const when = (occurredAt: string) => formatDateTimeDisplay(occurredAt, displayPreferences);
  switch (issue.type) {
    case 'FINDINGS':
      return (
        <SectionRows>
          {issue.items.map((item) => (
            <SectionRow
              facts={`${String(item.count)} open`}
              key={item.severity}
              name={enumLabel('ProviderSyncFindingSeverity', item.severity)}
              testId={`root-admin-sports-issue-findings-${item.severity}`}
              to={buildLeagueOpenFindingsPath(sportLeagueName, item.severity)}
            />
          ))}
        </SectionRows>
      );
    case 'SYNC':
      return (
        <SectionRows>
          {issue.items.map((item) => (
            <SectionRow
              actions={(
                <Button
                  data-testid={`root-admin-sports-issue-run-${item.target.id}`}
                  onClick={() => onOpenSyncRun(item.target.id)}
                  size="sm"
                  variant="secondary"
                >
                  Open run
                </Button>
              )}
              facts={`${when(item.occurredAt)} · ${item.label}`}
              key={item.target.id}
              name={syncFailedText(item.syncKind)}
            />
          ))}
        </SectionRows>
      );
    case 'RELEASE':
      return (
        <SectionRows>
          {issue.items.map((item) => (
            <SectionRow
              facts={`${when(item.occurredAt)} · ${item.failedChecks.map((key) => RELEASE_CHECK_LABELS[key]).join(', ')} failed`}
              key={item.target.id}
              name={item.label}
              testId={`root-admin-sports-issue-event-${item.target.id}`}
              to={buildSportEventPath(sport, item.target.id)}
            />
          ))}
        </SectionRows>
      );
    case 'OVERDUE':
      return (
        <SectionRows>
          {issue.items.map((item) => (
            <SectionRow
              facts={`Should have ended ${when(item.occurredAt)} · ${overdueLateness(item.occurredAt, new Date())}`}
              key={item.target.id}
              name={item.label}
              testId={`root-admin-sports-issue-event-${item.target.id}`}
              to={buildSportEventPath(sport, item.target.id)}
            />
          ))}
        </SectionRows>
      );
    default:
      return assertNever(issue);
  }
}
