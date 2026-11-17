import type { ReactNode } from 'react';
import { ContestEntryStatus, ContestStatus } from '@poolmaster/shared/domain';
import type { ContestDto, ContestEntryDto, ContestEntryPlaceDto } from '@/lib/api';
import { currentContestEvent, entryEventStatus } from '@/features/contests/contest-events';
import { CONTEST_ENTRY_STATUS_LABELS, areContestEntriesOpen } from '@/features/contests/contest-status';
import { orderCurrentContests } from '@/features/contests/current-contests';
import { useMyContestEntries } from '@/features/contests/use-contest-entries';
import { listedContestStartsAt } from '@/features/contests/use-contest-schedule';
import { useLeagueContestsQuery } from '@/features/contests/use-league-contests-query';
import { buildLeagueContestEntryPath, buildLeagueContestPath } from '@/features/leagues/league-routing';
import {
  DateDisplay,
  ErrorState,
  LinkButton,
  LoadingState,
  SectionCard,
  SectionEmpty,
  SectionRow,
  SectionRows,
  formatNumber,
  formatPlace,
  useDisplayPreferences,
} from '@/features/shared/ui';

/**
 * My team's Your entries (#1763): one row per entry the team has in a current contest, "Sharks 1 ·
 * CFP Championship Stars", in Home's order (open soonest closing, then live). A row says where the
 * entry stands, Submitted or Draft and when entries close, or its live place, and offers Edit
 * picks while entries are open. The row opens the contest page. It reads the same two queries as
 * League Home, so moving between them reads nothing again.
 */
export function YourEntriesSection({ leagueCode, leagueId, now }: { leagueCode: string; leagueId: string; now: Date }) {
  const contestsQuery = useLeagueContestsQuery(leagueId);
  const myEntries = useMyContestEntries(leagueId, true);
  const contests = orderCurrentContests(contestsQuery.data ?? [], { showDrafts: false });

  return (
    <SectionCard testId="my-team-your-entries" title="Your entries">
      {contestsQuery.isError || myEntries.isError ? (
        <ErrorState body="We couldn't load your entries." onRetry={() => void contestsQuery.refetch()} size="inline" testId="my-team-your-entries-error" />
      ) : contestsQuery.isLoading || myEntries.isLoading ? (
        <LoadingState body="Loading your entries..." rows={2} size="inline" />
      ) : (
        <EntryRows
          contests={contests}
          entriesByContestId={myEntries.entriesByContestId}
          leagueCode={leagueCode}
          now={now}
          placeByEntryId={myEntries.placeByEntryId}
        />
      )}
    </SectionCard>
  );
}

function EntryRows({
  contests,
  entriesByContestId,
  leagueCode,
  now,
  placeByEntryId,
}: {
  contests: readonly ContestDto[];
  entriesByContestId: ReadonlyMap<string, readonly ContestEntryDto[]>;
  leagueCode: string;
  now: Date;
  placeByEntryId: ReadonlyMap<string, ContestEntryPlaceDto>;
}) {
  const { locale } = useDisplayPreferences();
  const rows = contests.flatMap((contest) => (entriesByContestId.get(contest.id) ?? []).map((entry) => ({ contest, entry })));
  if (!rows.length) {
    return <SectionEmpty testId="my-team-your-entries-none">You have no entries in a current contest.</SectionEmpty>;
  }

  return (
    <SectionRows>
      {rows.map(({ contest, entry }) => {
        const testId = `my-team-entry-${entry.id}`;
        const startsAt = listedContestStartsAt(contest);
        const isOpen = areContestEntriesOpen(contest, startsAt, now);
        const status = entryEventStatus(entry, currentContestEvent(contest, now)?.sportEventId);
        const place = placeByEntryId.get(entry.id);
        let facts: ReactNode;
        if (contest.status === ContestStatus.ACTIVE) {
          facts = place ? `Live · ${formatPlace(place)} of ${formatNumber(contest.entryCount ?? 0, locale)}` : 'Live';
        } else if (isOpen && startsAt) {
          facts = <>{CONTEST_ENTRY_STATUS_LABELS[status]} · closes <DateDisplay timeStyle={null} tone="inherit" value={startsAt} /></>;
        } else {
          facts = CONTEST_ENTRY_STATUS_LABELS[status];
        }
        return (
          <SectionRow
            actions={isOpen ? (
              <LinkButton data-testid={`${testId}-edit-picks`} size="sm" to={buildLeagueContestEntryPath(leagueCode, contest.id, entry.id)}>
                {status === ContestEntryStatus.SUBMITTED ? 'Edit picks' : 'Finish your picks'}
              </LinkButton>
            ) : undefined}
            facts={<span data-testid={`${testId}-status`}>{facts}</span>}
            key={entry.id}
            name={`${entry.name} · ${contest.name}`}
            testId={testId}
            to={buildLeagueContestPath(leagueCode, contest.id)}
          />
        );
      })}
    </SectionRows>
  );
}
