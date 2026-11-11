import { useParams, useSearchParams } from "react-router";
import { useEffect, useMemo } from "react";
import { useLeagueContextGuard } from "@/features/leagues/league-context-guard";
import { getLogger } from "@/lib/logger";
import { ErrorState, LoadingState, SectionCard } from "@/features/shared/ui";
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { ContestsPageHeader } from './contests-page-header';
import { CurrentContestList } from './current-contest-list';
import { useMyContestEntries } from './use-contest-entries';
import { useLeagueContestsQuery } from './use-league-contests-query';

/**
 * Contests › Current (#1390): every current contest in the league, in the shared list League
 * Home uses, with entry counts. `?focus={contestId}` tints and scrolls to the contest the viewer
 * came from; an id that is not listed just shows the list.
 */
export function LeagueContestsPage() {
  const { leagueCode = "" } = useParams<{ leagueCode: string }>();
  const [searchParams] = useSearchParams();
  const focusContestId = searchParams.get("focus");
  const logger = useMemo(() => getLogger().child({ feature: "league-contests-page" }), []);

  // #202 — one league-context call, shared. Carries the viewer's own edges (A8).
  const { query: leagueQuery, league, viewer } = useLeagueContext(leagueCode);

  useEffect(() => {
    if (!leagueQuery.isError) {
      return;
    }

    logger.warn(
      { action: "leagueContests.league.failed", data: { leagueCode }, err: leagueQuery.error },
      "League Contests page failed to load league context",
    );
  }, [leagueCode, leagueQuery.error, leagueQuery.isError, logger]);

  const leagueId = league?.id ?? "";
  // The list holds the current contests only (#1161); finished ones are on the Past tab.
  const contestsQuery = useLeagueContestsQuery(leagueId);
  const hasTeam = viewer.mySquadId !== null;
  const myEntries = useMyContestEntries(leagueId, hasTeam);
  useEffect(() => {
    if (!myEntries.isError) {
      return;
    }

    logger.warn(
      { action: "leagueContests.myEntries.failed", data: { leagueCode } },
      "League Contests page failed to load the team's contest entries",
    );
  }, [leagueCode, myEntries.isError, logger]);
  const leagueContext = useLeagueContextGuard(leagueQuery, {
    loadingBody: "Loading league contests...",
  });

  // `!league` is unreachable once the guard reports ready — it is here so the league is
  // narrowed for everything below rather than threaded as `league?.` throughout.
  if (leagueContext.state === 'blocked' || !league) {
    return leagueContext.element;
  }

  return (
    <section className="space-y-6" data-testid="league-contests-page">
      <ContestsPageHeader leagueCode={league.leagueCode} view="current" />

      {contestsQuery.isLoading ? (
        <LoadingState body="Loading contests..." />
      ) : contestsQuery.isError ? (
        <ErrorState body="We couldn't load contests for this league." />
      ) : (
        <SectionCard testId="league-contests-current" title="Current contests">
          <CurrentContestList
            contests={contestsQuery.data ?? []}
            emptyBody="No open or live contests."
            entriesByContestId={myEntries.entriesByContestId}
            entriesState={myEntries.state}
            focusContestId={focusContestId}
            hasTeam={hasTeam}
            leagueCode={league.leagueCode}
            showDrafts={viewer.isCommissioner || viewer.isRootAdmin}
            showEntryCount
            testIdPrefix="league-contest"
          />
        </SectionCard>
      )}
    </section>
  );
}
