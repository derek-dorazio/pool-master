import { ContestStatus, CupStatus, PlanFeature } from '@poolmaster/shared/domain';
import { useCallback, useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import type { CupDto } from '@/lib/api';
import { buildLeagueCupSquadPath, buildLeaguePointsRacePath, buildLeagueTrophyCasePath } from '@/features/leagues/league-routing';
import {
  Chip,
  EmptyState,
  ErrorState,
  formatDateDisplay,
  LinkButton,
  LoadingState,
  MetricGrid,
  MetricTile,
  Tile,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { hasPlanFeature } from '@/features/plans/plan-features';
import { PlanLockedNotice } from '@/features/plans/plan-locked-notice';
import { buildPodium } from './championship-view';
import { CupContestList } from './cup-contest-list';
import { CupRaceChart } from './cup-race-chart';
import { CupStandingsGrid } from './cup-standings-grid';
import {
  buildRaceSeries,
  cupLeaders,
  cupProgress,
  cupsOnShow,
  describeProjection,
  formatCupPoints,
  formatPlace,
  hasLiveContest,
  isCupSeasonOver,
  nextContestToCount,
} from './cup-view';
import { Podium } from './podium';
import { useChampionshipsRoute } from './use-championships-route';
import { useCupProjectionQuery, useSeasonCupsQuery } from './use-cups-query';

/** The year's cups as chips, one per sports league, scrolling sideways when there are many. */
function CupChips({ cups, leagueCode, selectedId, year }: { cups: CupDto[]; leagueCode: string; selectedId: string; year: number }) {
  return (
    <nav aria-label="Sports league cups" className="flex gap-2 overflow-x-auto pb-1">
      {cups.map((cup) => {
        const isSelected = cup.sportLeagueId === selectedId;
        return (
          <Link
            aria-current={isSelected ? 'page' : undefined}
            className="shrink-0"
            data-testid={`cup-chip-${cup.sportLeagueId}`}
            key={cup.id}
            to={buildLeaguePointsRacePath(leagueCode, year, cup.sportLeagueId)}
          >
            <Chip tone={isSelected ? 'final' : 'neutral'}>{cup.sportLeagueName}</Chip>
          </Link>
        );
      })}
    </nav>
  );
}

/** Leader or champion, the viewer's place, and while the cup's season runs the contest that counts next. */
function CupStatTiles({ cup, isSeasonOver, mySquadId }: { cup: CupDto; isSeasonOver: boolean; mySquadId: string | null }) {
  const displayPreferences = useDisplayPreferences();
  const leaders = cupLeaders(cup);
  const leaderPoints = leaders[0]?.points ?? 0;
  const mine = cup.standings.find((row) => row.squadId === mySquadId);
  const next = nextContestToCount(cup);
  const isCrowned = cup.status === CupStatus.CROWNED;

  return (
    <MetricGrid>
      <MetricTile
        helperText={leaders.length ? `${formatCupPoints(leaderPoints)} pts` : undefined}
        label={isCrowned ? (leaders.length > 1 ? 'Champions' : 'Champion') : isSeasonOver ? 'Finished 1st' : 'Leader'}
        value={leaders.length ? leaders.map((row) => row.squadName).join(', ') : 'Nobody yet'}
      />
      {mine ? (
        <MetricTile
          helperText={!leaders.length
            ? undefined
            : mine.position === 1 ? 'In the lead' : `${formatCupPoints(leaderPoints - mine.points)} behind`}
          label="You"
          value={formatPlace(mine)}
        />
      ) : null}
      {isCrowned || isSeasonOver ? null : (
        <MetricTile
          helperText={next
            ? next.status === ContestStatus.ACTIVE ? 'Live now' : `Starts ${formatDateDisplay(next.firstEventStartsAt, displayPreferences)}`
            : undefined}
          label="Next to count"
          value={next?.name ?? 'Every contest is final'}
        />
      )}
    </MetricGrid>
  );
}

/**
 * Points race: one sports league cup's standings, how the top squads got there, and every contest
 * in it; a crowned cup's podium above its frozen standings, and "Not crowned" for a past season's
 * cup that never was, which drops the live parts. While a contest it counts is live, the
 * standings carry a greyed "If it ended now" column. A squad opens its points contest by contest;
 * a contest opens its leaderboard. On a plan without cups, the locked note instead, and without
 * crowning no podium (#948).
 */
export function PointsRacePage() {
  const displayPreferences = useDisplayPreferences();
  const { sportLeagueId } = useParams<{ sportLeagueId: string }>();
  const { league, leagueCode, leagueId, viewer, year } = useChampionshipsRoute();
  const isInPlan = hasPlanFeature(league, PlanFeature.CUP_STANDINGS);
  const cupsQuery = useSeasonCupsQuery(isInPlan ? leagueId : '', year);
  const squadPath = useCallback(
    (squadId: string) => buildLeagueCupSquadPath(leagueCode, year, sportLeagueId ?? '', squadId),
    [leagueCode, sportLeagueId, year],
  );
  // poolmaster-allow-list-lookup: a league's cups for one year, one per sport league
  const cup = cupsQuery.data?.find((candidate) => candidate.sportLeagueId === sportLeagueId);
  const projectionQuery = useCupProjectionQuery(leagueId, cup?.id ?? '', cup !== undefined && hasLiveContest(cup));
  const projection = projectionQuery.data;
  const projectedBySquad = useMemo(
    () => (projection?.contests.length ? new Map(projection.standings.map((row) => [row.squadId, row])) : undefined),
    [projection],
  );

  if (!isInPlan) {
    return <PlanLockedNotice feature={PlanFeature.CUP_STANDINGS} isCommissioner={viewer.isCommissioner} leagueCode={leagueCode} />;
  }
  if (cupsQuery.isLoading) {
    return <LoadingState body="Loading the points race..." />;
  }
  if (cupsQuery.isError) {
    return <ErrorState body="We couldn't load this year's cups." testId="points-race-error" />;
  }
  // The chips offer the cups on show; a link straight to another cup still opens it.
  const allCups = cupsQuery.data ?? [];
  const cups = cupsOnShow(allCups);
  const firstCup = cups.at(0);
  if (!sportLeagueId) {
    return firstCup
      ? <Navigate replace to={buildLeaguePointsRacePath(leagueCode, year, firstCup.sportLeagueId)} />
      : <EmptyState body={`No sports league has two counted contests in ${year} yet.`} testId="points-race-empty" title="No cups yet" />;
  }
  if (!cup) {
    return (
      <EmptyState
        action={<LinkButton size="sm" to={buildLeagueTrophyCasePath(leagueCode, year)} variant="secondary">Trophy case</LinkButton>}
        body={`This league has no cup for that sports league in ${year}.`}
        testId="points-race-no-cup"
        title="Cup not found"
      />
    );
  }
  const progress = cupProgress(cup);
  const isSeasonOver = isCupSeasonOver(cup, new Date());
  const isCrowned = cup.status === CupStatus.CROWNED;

  return (
    <div className="space-y-6" data-testid="points-race">
      <CupChips cups={cups.includes(cup) ? cups : [...cups, cup]} leagueCode={leagueCode} selectedId={cup.sportLeagueId} year={year} />
      <Tile className="space-y-5" padding="sm" radius="lg">
        <div>
          <h2 className="title-card text-xl text-foreground">{cup.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground" data-testid="points-race-summary">
            {cup.sportLeagueName} · {cup.crownedAt
              ? `Crowned ${formatDateDisplay(cup.crownedAt, displayPreferences)}`
              : isSeasonOver ? 'Not crowned' : `${progress.final} of ${progress.total} contests final`}
          </p>
        </div>
        {isCrowned ? (
          hasPlanFeature(league, PlanFeature.CUP_CROWNING)
            ? <Podium focusSquadId={viewer.mySquadId} steps={buildPodium(cup.standings)} testId="cup-podium" />
            : null
        ) : isSeasonOver ? (
          <p className="text-sm text-muted-foreground" data-testid="cup-not-crowned">
            {'This cup hasn\'t been crowned, so it has no trophies yet. These are its final standings.'}
          </p>
        ) : null}
        <CupStatTiles cup={cup} isSeasonOver={isSeasonOver} mySquadId={viewer.mySquadId} />
        {projection && projectedBySquad ? (
          <p className="text-sm text-muted-foreground" data-testid="cup-projection-note">{describeProjection(projection)}</p>
        ) : null}
        {projectionQuery.isError ? (
          <p className="text-sm text-muted-foreground" data-testid="cup-projection-error">{'We couldn\'t work out where squads would stand if the live contests ended now.'}</p>
        ) : null}
        <CupStandingsGrid
          focusSquadId={viewer.mySquadId}
          projection={projectedBySquad}
          rows={cup.standings}
          showMovement={!isSeasonOver}
          squadPath={squadPath}
        />
      </Tile>
      <Tile className="space-y-3" padding="sm" radius="lg">
        <div>
          <h2 className="title-card text-lg text-foreground">The race so far</h2>
          <p className="text-sm text-muted-foreground">Top five, after each final contest</p>
        </div>
        <CupRaceChart focusSquadId={viewer.mySquadId} series={buildRaceSeries(cup)} />
      </Tile>
      <Tile className="space-y-3" padding="sm" radius="lg">
        <h2 className="title-card text-lg text-foreground">Contests in this cup</h2>
        <CupContestList contests={cup.contests} leagueCode={leagueCode} />
      </Tile>
    </div>
  );
}
