import { formatSelectionTypeName, pluralize } from '@poolmaster/shared/domain';
import type { ContestDto, ContestEntryDto, ContestEntryPlaceDto } from '@/lib/api';
import { formatPlace } from '@/features/championships/cup-view';
import { buildContestLandingPath } from '@/features/leagues/league-routing';
import { Eyebrow, SectionEmpty, SectionRows } from '@/features/shared/ui';
import { ContestRow } from './contest-row';
import { CURRENT_CONTEST_GROUP_LABEL, groupCurrentContests } from './current-contests';
import { describeMyEntry, type MyEntriesState } from './my-contest-entry';
import { listedContestStartsAt } from './use-contest-schedule';

/**
 * A league's current contests (#1390), the one list League Home and the Contests page share:
 * grouped Live, Open for entries, then Draft (commissioners only), each row saying where the
 * viewer's entry stands in the same words everywhere and opening the contest by the one link rule.
 * The group heading names the status, so a row carries no badge of its own, which leaves a phone
 * row room for the contest's name. A live contest's row shows the place of the viewer's best
 * entry, as its leaderboard has it (#1565), and a viewer with several entries in a contest sees
 * how many in its fact line. Drawn as a section card's body; `focusContestId` tints and scrolls to
 * the contest the viewer came from.
 */
export function CurrentContestList({
  bestPlaceByContestId,
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
  /** The best place among the viewer's entries in each live contest that ranks one. */
  bestPlaceByContestId: ReadonlyMap<string, ContestEntryPlaceDto>;
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
    return <SectionEmpty testId={`${testIdPrefix}-empty`}>{emptyBody}</SectionEmpty>;
  }

  return (
    <div data-testid={`${testIdPrefix}-list`}>
      {sections.map(({ contests: grouped, group }) => (
        <section aria-label={CURRENT_CONTEST_GROUP_LABEL[group]} data-testid={`${testIdPrefix}-group-${group}`} key={group}>
          <Eyebrow className="px-4 pb-1 pt-3" tone="muted">{CURRENT_CONTEST_GROUP_LABEL[group]}</Eyebrow>
          <SectionRows>
            {grouped.map((contest) => {
              const myEntries = entriesByContestId.get(contest.id);
              const bestPlace = bestPlaceByContestId.get(contest.id);
              return (
                <ContestRow
                  details={describeContestFacts(contest, showEntryCount, myEntries?.length ?? 0)}
                  isHighlighted={contest.id === focusContestId}
                  key={contest.id}
                  name={contest.name}
                  note={describeMyEntry(leagueCode, contest, myEntries, entriesState, hasTeam).note}
                  startsAt={listedContestStartsAt(contest)}
                  testId={`${testIdPrefix}-${contest.id}`}
                  to={buildContestLandingPath(leagueCode, contest)}
                  trailing={bestPlace ? formatPlace(bestPlace) : null}
                />
              );
            })}
          </SectionRows>
        </section>
      ))}
    </div>
  );
}

/**
 * A row's fact line after its date: the contest's kind, its entry count on the full list, and how
 * many entries the viewer has when they have more than one (#1565).
 */
function describeContestFacts(contest: ContestDto, showEntryCount: boolean, myEntryCount: number): string {
  return [
    formatSelectionTypeName(contest.selectionType),
    ...(showEntryCount ? [pluralize(contest.entryCount ?? 0, 'entry', 'entries')] : []),
    ...(myEntryCount > 1 ? [`Your ${String(myEntryCount)} entries`] : []),
  ].join(' · ');
}
