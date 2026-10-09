import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ContestStatus } from '@poolmaster/shared/domain';
import { useMyContestEntries } from '@/features/contests/use-contest-entries';
import { useContestSchedules } from '@/features/contests/use-contest-schedule';
import { useLeagueContestsQuery } from '@/features/contests/use-league-contests-query';
import {
  Alert,
  EmptyState,
  ErrorState,
  IdentityHeading,
  LinkButton,
  LoadingState,
} from '@/features/shared/ui';
import { useLeagueSquadsQuery } from '@/features/teams/use-league-squads-query';
import { getLogger } from '@/lib/logger';
import { parseRouteState } from '@/routes/route-state';
import { useLeagueContextGuard } from './league-context-guard';
import { pickUpNextContest } from './league-home';
import { LiveStandingsCard, OtherContestsCard, UpNextCard, YourTeamCard } from './league-home-cards';
import { LeagueIcon } from './league-icon';
import { buildLeagueContestsPath, buildLeagueTeamPath } from './league-routing';
import { useLeagueContext } from './use-league-context';

const CLOCK_TICK_MS = 60_000;

/** The current time, refreshed every minute so a countdown keeps moving. */
function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * League Home: the league's identity once, then what needs the member now: the contest that
 * closes soonest, live standings for a contest they are in, and their own team.
 */
export function LeagueHomePage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const logger = useMemo(() => getLogger().child({ feature: 'league-home-page' }), []);
  const now = useMinuteClock();

  // Read once and remembered for this league only, because the effect below drops it from history
  // so Back or a reload does not show the notice again.
  const [teamSetupFailedLeagueCode] = useState(() =>
    parseRouteState(location.state).teamSetupFailed ? leagueCode : null,
  );
  const teamSetupFailed = teamSetupFailedLeagueCode === leagueCode;
  useEffect(() => {
    if (parseRouteState(location.state).teamSetupFailed) {
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    }
  }, [location.pathname, location.search, location.state, navigate]);

  const { query: leagueQuery, league, viewer } = useLeagueContext(leagueCode);
  const leagueId = league?.id ?? '';
  const contestsQuery = useLeagueContestsQuery(leagueId);
  const squadsQuery = useLeagueSquadsQuery(leagueId);

  useEffect(() => {
    if (leagueQuery.isError) {
      logger.warn(
        { action: 'leagueHome.league.failed', data: { leagueCode }, err: leagueQuery.error },
        'League Home failed to load league context',
      );
    }
  }, [leagueCode, leagueQuery.error, leagueQuery.isError, logger]);

  // Members never see a draft; what is open or live is what Home is about.
  const currentContests = useMemo(
    () => (contestsQuery.data ?? []).filter(
      (contest) => contest.status === ContestStatus.OPEN || contest.status === ContestStatus.ACTIVE,
    ),
    [contestsQuery.data],
  );
  const schedules = useContestSchedules(currentContests);
  const myEntries = useMyContestEntries(
    currentContests.map((contest) => contest.id),
    viewer.mySquadId,
  );

  const leagueContext = useLeagueContextGuard(leagueQuery, { loadingBody: 'Loading league...' });
  if (leagueContext.state === 'blocked' || !league) {
    return leagueContext.element;
  }

  const upNext = pickUpNextContest(currentContests, schedules, now);
  const otherContests = currentContests.filter((contest) => contest.id !== upNext?.contest.id);
  const liveContest = currentContests.find(
    (contest) => contest.status === ContestStatus.ACTIVE
      && (myEntries.entriesByContestId.get(contest.id)?.length ?? 0) > 0,
  );
  const myTeam = squadsQuery.data?.find((squad) => squad.id === viewer.mySquadId) ?? null;
  const hasTeam = viewer.mySquadId !== null;

  return (
    <section className="space-y-6" data-testid="league-home">
      {teamSetupFailed ? (
        <Alert data-testid="league-team-setup-failed" tone="warning">
          <p>You&apos;re in the league. We couldn&apos;t save your team name and icon. You can set them from My team.</p>
          <LinkButton className="mt-3" size="sm" to={buildLeagueTeamPath(leagueCode)} variant="subtle">
            My team
          </LinkButton>
        </Alert>
      ) : null}
      {!league.isActive ? (
        <Alert data-testid="league-inactive-banner" title="This league is not currently active." tone="warning">
          <p>You can still see standings and history. Entries and changes are closed while the league is inactive.</p>
        </Alert>
      ) : null}

      <div className="space-y-1">
        <IdentityHeading
          code={{ label: 'league code', value: league.leagueCode }}
          icon={<LeagueIcon iconKey={league.iconKey} size="lg" />}
          meta={(
            <span data-testid="league-home-counts">
              {plural(league.memberCount, 'member', 'members')} · {plural(league.activeContestCount, 'active contest', 'active contests')}
            </span>
          )}
          name={league.name}
          testId="league-home-identity"
        />
        {league.description?.trim() ? (
          <p className="max-w-3xl pl-16 text-sm text-muted-foreground" data-testid="league-home-description">
            {league.description}
          </p>
        ) : null}
      </div>

      {contestsQuery.isLoading ? (
        <LoadingState body="Loading contests..." />
      ) : contestsQuery.isError ? (
        <ErrorState body="We couldn't load this league's contests." />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="grid gap-5">
            {upNext ? (
              <UpNextCard
                hasTeam={hasTeam}
                leagueCode={leagueCode}
                myEntries={myEntries.entriesByContestId.get(upNext.contest.id)}
                now={now}
                upNext={upNext}
              />
            ) : null}
            {currentContests.length ? (
              <OtherContestsCard
                contests={otherContests}
                entriesByContestId={myEntries.entriesByContestId}
                hasTeam={hasTeam}
                leagueCode={leagueCode}
              />
            ) : (
              <EmptyState
                action={(
                  <LinkButton size="sm" to={buildLeagueContestsPath(leagueCode)} variant="secondary">
                    All contests
                  </LinkButton>
                )}
                body="No contests are open or live right now. Past contests are under Contests."
                testId="league-home-no-contests"
              />
            )}
          </div>
          <div className="grid gap-5">
            {liveContest ? (
              <LiveStandingsCard contest={liveContest} leagueCode={leagueCode} mySquadId={viewer.mySquadId} />
            ) : null}
            {viewer.isMember ? (
              <YourTeamCard isLoading={squadsQuery.isLoading} leagueCode={leagueCode} team={myTeam} />
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
