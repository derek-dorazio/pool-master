import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { championshipYear, ContestStatus, PlanFeature } from '@poolmaster/shared/domain';
import { useMyContestEntries } from '@/features/contests/use-contest-entries';
import { useLeagueContestsQuery } from '@/features/contests/use-league-contests-query';
import {
  Alert,
  ErrorState,
  PageHeader,
  LinkButton,
  LoadingState,
} from '@/features/shared/ui';
import { useLeagueSquadQuery } from '@/features/teams/use-league-squad-query';
import { getLogger } from '@/lib/logger';
import { plural } from '@/lib/plural';
import { parseRouteState } from '@/routes/route-state';
import { useLeagueContextGuard } from './league-context-guard';
import { pickUpNextContest } from './league-home';
import { CupsCard, CurrentContestsCard, LiveStandingsCard, UpNextCard, YourTeamCard } from './league-home-cards';
import { LeagueIcon } from './league-icon';
import { buildLeagueTeamPath } from './league-routing';
import { useLeagueContext } from './use-league-context';
import { YearReviewBanner } from '@/features/championships/year-review-banner';
import { hasPlanFeature } from '@/features/plans/plan-features';
import { OpensSoonCard } from '@/features/event-pages/opens-soon-card';

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

/**
 * League Home: the league's identity once, then what needs the member now: the contest that
 * closes soonest, live standings for each contest they are in, and their own team.
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
      void navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    }
  }, [location.pathname, location.search, location.state, navigate]);

  const { query: leagueQuery, league, viewer } = useLeagueContext(leagueCode);
  const leagueId = league?.id ?? '';
  const contestsQuery = useLeagueContestsQuery(leagueId);
  const myTeamQuery = useLeagueSquadQuery(leagueId, viewer.mySquadId);

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
    // poolmaster-allow-list-lookup: the league's current contests (#1161), dropping the drafts members never see
    () => (contestsQuery.data ?? []).filter(
      (contest) => contest.status === ContestStatus.OPEN || contest.status === ContestStatus.ACTIVE,
    ),
    [contestsQuery.data],
  );
  const myEntries = useMyContestEntries(leagueId, viewer.mySquadId !== null);

  const leagueContext = useLeagueContextGuard(leagueQuery, { loadingBody: 'Loading league...' });
  if (leagueContext.state === 'blocked' || !league) {
    return leagueContext.element;
  }

  const upNext = pickUpNextContest(currentContests, now);
  const otherContests = currentContests.filter((contest) => contest.id !== upNext?.contest.id);
  const liveContests = currentContests.filter(
    (contest) => contest.status === ContestStatus.ACTIVE
      && (myEntries.entriesByContestId.get(contest.id)?.length ?? 0) > 0,
  );
  const myTeam = myTeamQuery.data ?? null;
  const hasTeam = viewer.mySquadId !== null;
  const entriesState = myEntries.state;

  return (
    <section className="space-y-6" data-testid="league-home">
      {teamSetupFailed ? (
        <Alert data-testid="league-team-setup-failed" tone="warning">
          <p>You&apos;re in the league, but we couldn&apos;t save the name and icon you chose. You can set them now.</p>
          <LinkButton className="mt-3" size="sm" to={buildLeagueTeamPath(leagueCode)} variant="subtle">
            Set your name and icon
          </LinkButton>
        </Alert>
      ) : null}
      {!league.isActive ? (
        <Alert data-testid="league-inactive-banner" title="This league is not currently active." tone="warning">
          <p>You can still see standings and history. Entries and changes are closed while the league is inactive.</p>
        </Alert>
      ) : null}
      {viewer.isCommissioner ? <OpensSoonCard leagueCode={leagueCode} /> : null}
      <YearReviewBanner isCommissioner={viewer.isCommissioner} league={league} />

      <PageHeader
        description={league.description?.trim() ? (
          <span data-testid="league-home-description">{league.description}</span>
        ) : undefined}
        icon={<LeagueIcon iconKey={league.iconKey} size="lg" />}
        meta={(
          <span data-testid="league-home-counts">
            {plural(league.memberCount, 'member')} · {plural(league.activeContestCount, 'active contest')}
          </span>
        )}
        testId="league-home-identity"
        title={league.name}
      />

      {contestsQuery.isLoading ? (
        <LoadingState body="Loading contests..." />
      ) : contestsQuery.isError ? (
        <ErrorState body="We couldn't load this league's contests." />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="grid gap-5">
            {upNext ? (
              <UpNextCard
                entriesState={entriesState}
                hasTeam={hasTeam}
                leagueCode={leagueCode}
                myEntries={myEntries.entriesByContestId.get(upNext.contest.id)}
                now={now}
                upNext={upNext}
              />
            ) : null}
            <CurrentContestsCard
              contests={otherContests}
              emptyBody={upNext ? 'No other open or live contests.' : 'No open or live contests.'}
              entriesByContestId={myEntries.entriesByContestId}
              entriesState={entriesState}
              hasTeam={hasTeam}
              leagueCode={leagueCode}
            />
          </div>
          <div className="grid gap-5">
            {liveContests.length ? (
              <LiveStandingsCard contests={liveContests} leagueCode={leagueCode} mySquadId={viewer.mySquadId} />
            ) : null}
            {hasPlanFeature(league, PlanFeature.CUP_STANDINGS) ? (
              <CupsCard
                leagueCode={leagueCode}
                leagueId={leagueId}
                mySquadId={viewer.mySquadId}
                year={championshipYear(now)}
              />
            ) : null}
            {viewer.isMember ? (
              <YourTeamCard isLoading={myTeamQuery.isLoading} leagueCode={leagueCode} team={myTeam} />
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
