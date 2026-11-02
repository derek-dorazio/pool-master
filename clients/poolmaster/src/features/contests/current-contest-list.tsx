import { formatSelectionTypeName, pluralize } from '@poolmaster/shared/domain';
import type { ContestDto, ContestEntryDto } from '@/lib/api';
import { buildContestLandingPath } from '@/features/leagues/league-routing';
import { EmptyState, Eyebrow, PanelList } from '@/features/shared/ui';
import { ContestRow } from './contest-row';
import { CURRENT_CONTEST_GROUP_LABEL, groupCurrentContests } from './current-contests';
import { describeMyEntry, type MyEntriesState } from './my-contest-entry';
import { listedContestStartsAt } from './use-contest-schedule';

/**
 * A league's current contests (#1390), the one list League Home and the Contests page share:
 * grouped Live, Open for entries, then Draft (commissioners only), each row saying where the
 * viewer's entry stands in the same words everywhere and opening the contest by the one link rule.
 * The group heading names the status, so a row carries no badge of its own, which leaves a phone
 * row room for the contest's name. Drawn as a panel card's body; `focusContestId` tints and
 * scrolls to the contest the viewer came from.
 */
export function CurrentContestList({
  contests,
  emptyBody,
  entriesByContestId,
  entriesState,
  focusContestId = null,
  hasTeam,
  leagueCode,
  showDrafts,
  showEntryCount = false,
  testIdPrefix,
}: {
  contests: readonly ContestDto[];
  emptyBody: string;
  entriesByContestId: ReadonlyMap<string, readonly ContestEntryDto[]>;
  entriesState: MyEntriesState;
  focusContestId?: string | null;
  hasTeam: boolean;
  leagueCode: string;
  /** Whether the viewer commissions the league or is a root admin, the only people who see a draft. */
  showDrafts: boolean;
  /** Each row's entry count after its kind, for the Contests page's full list. */
  showEntryCount?: boolean;
  testIdPrefix: string;
}) {
  const sections = groupCurrentContests(contests, { showDrafts });
  if (!sections.length) {
    return (
      <div className="p-4">
        <EmptyState body={emptyBody} size="inline" testId={`${testIdPrefix}-empty`} />
      </div>
    );
  }

  return (
    <div data-testid={`${testIdPrefix}-list`}>
      {sections.map(({ contests: grouped, group }) => (
        <section aria-label={CURRENT_CONTEST_GROUP_LABEL[group]} data-testid={`${testIdPrefix}-group-${group}`} key={group}>
          <Eyebrow className="px-4 pb-1 pt-3" tone="muted">{CURRENT_CONTEST_GROUP_LABEL[group]}</Eyebrow>
          <PanelList>
            {grouped.map((contest) => (
              <li key={contest.id}>
                <ContestRow
                  density="compact"
                  details={showEntryCount
                    ? `${formatSelectionTypeName(contest.selectionType)} · ${pluralize(contest.entryCount ?? 0, 'entry', 'entries')}`
                    : formatSelectionTypeName(contest.selectionType)}
                  isHighlighted={contest.id === focusContestId}
                  name={contest.name}
                  note={describeMyEntry(leagueCode, contest, entriesByContestId.get(contest.id), entriesState, hasTeam).note}
                  startsAt={listedContestStartsAt(contest)}
                  testId={`${testIdPrefix}-${contest.id}`}
                  to={buildContestLandingPath(leagueCode, contest)}
                />
              </li>
            ))}
          </PanelList>
        </section>
      ))}
    </div>
  );
}
