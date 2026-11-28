import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { easternCalendarYear, PlanFeature } from '@poolmaster/shared/domain';
import { useMyContestEntries } from '@/features/contests/use-contest-entries';
import { useLeagueContestsQuery } from '@/features/contests/use-league-contests-query';
import {
  Notice,
  ErrorState,
  PageHeader,
  LinkButton,
  LoadingState,
  useMinuteClock,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { plural } from '@/lib/plural';
import { parseRouteState } from '@/routes/route-state';
import { useLeagueContextGuard } from './league-context-guard';
import { splitHomeContests } from './league-home';
import { useRecentlyFinalContests } from './use-recently-final-contests';
import { CupsCard, MoreContestsCard } from './league-home-cards';
import { ContestHeroes } from './league-home-heroes';
import { LeagueIcon } from './league-icon';
import { buildLeagueTeamPath } from './league-routing';
import { useLeagueContext } from './use-league-context';
import { YearReviewBanner } from '@/features/championships/year-review-banner';
import { hasPlanFeature } from '@/features/plans/plan-features';
import { OpensSoonCard } from '@/features/event-pages/opens-soon-card';

/**
 * League Home: the league's identity once, then its contests (#1763): up to three hero tiles for
 * the contests that matter now (live first, then open by soonest close), then More contests, every
 * other current contest with the viewer's next step on its row and those gone final in the last
 * few days, and the year's cups. Older finished contests are on My team's Past contests.
 * `?focus={contestId}` tints and scrolls to the contest a contest page's breadcrumb came from.
 */
export function LeagueHomePage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const logger = useMemo(() => getLogger().child({ feature: 'league-home-page' }), []);
  const now = useMinuteClock();
  const [searchParams] = useSearchParams();

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

  useEffect(() => {
    if (leagueQuery.isError) {
      logger.warn(
        { action: 'leagueHome.league.failed', data: { leagueCode }, err: leagueQuery.error },
        'League Home failed to load league context',
      );
    }
  }, [leagueCode, leagueQuery.error, leagueQuery.isError, logger]);

  const myEntries = useMyContestEntries(leagueId, viewer.mySquadId !== null);
  const finals = useRecentlyFinalContests(leagueId, viewer.mySquadId, now);

  const leagueContext = useLeagueContextGuard(leagueQuery, { loadingBody: 'Loading league...' });
  if (leagueContext.state === 'blocked' || !league) {
    return leagueContext.element;
  }

  const showDrafts = viewer.isCommissioner || viewer.isRootAdmin;
  const { heroes, more } = splitHomeContests(contestsQuery.data ?? [], { now, showDrafts });
  const focusContestId = searchParams.get('focus');
  const hasTeam = viewer.mySquadId !== null;

  return (
    <section className="space-y-6" data-testid="league-home">
      {teamSetupFailed ? (
        <Notice data-testid="league-team-setup-failed" tone="warning">
          <p>You&apos;re in the league, but we couldn&apos;t save your team&apos;s name and icon. You can set them now.</p>
          <LinkButton className="mt-3" size="sm" to={buildLeagueTeamPath(leagueCode)} variant="subtle">
            Set up your team
          </LinkButton>
        </Notice>
      ) : null}
      {!league.isActive ? (
        <Notice data-testid="league-inactive-banner" title="This league is not currently active." tone="warning">
          <p>You can still see standings and history. Entries and changes are closed while the league is inactive.</p>
        </Notice>
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
        <LoadingState rows={3} body="Loading contests..." />
      ) : contestsQuery.isError ? (
        <ErrorState body="We couldn't load this league's contests." onRetry={() => void contestsQuery.refetch()} />
      ) : (
        <div className="space-y-5">
          {heroes.length ? (
            <ContestHeroes
              contests={heroes}
              focusContestId={focusContestId}
              hasTeam={hasTeam}
              leagueCode={leagueCode}
              myEntries={myEntries}
              mySquadId={viewer.mySquadId}
              now={now}
            />
          ) : null}
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            {more.length || finals.length || !heroes.length ? (
              <MoreContestsCard
                canExpand={viewer.isCommissioner}
                contests={more}
                finals={finals}
                focusContestId={focusContestId}
                hasHeroes={heroes.length > 0}
                hasTeam={hasTeam}
                leagueCode={leagueCode}
                myEntries={myEntries}
                now={now}
              />
            ) : null}
            {hasPlanFeature(league, PlanFeature.CUP_STANDINGS) ? (
              <CupsCard
                leagueCode={leagueCode}
                leagueId={leagueId}
                mySquadId={viewer.mySquadId}
                year={easternCalendarYear(now)}
              />
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
