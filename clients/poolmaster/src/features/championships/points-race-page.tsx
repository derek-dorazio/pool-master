import { ContestStatus, CupStatus, PlanFeature } from '@poolmaster/shared/domain';
import { useCallback, useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import type { CupDto } from '@/lib/api';
import { buildLeagueCupSquadPath, buildLeaguePointsRacePath, buildLeagueTrophyCasePath } from '@/features/leagues/league-routing';
import { Chip, ErrorState, formatCupPoints, formatDateDisplay, formatNumber, formatPlace, LoadingState, MetricGrid, MetricTile, SectionCard, SectionEmpty, SectionNote, useDisplayPreferences } from '@/features/shared/ui';
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
        helperText={leaders.length ? `${formatCupPoints(leaderPoints, displayPreferences.locale)} pts` : undefined}
        label={isCrowned ? (leaders.length > 1 ? 'Champions' : 'Champion') : isSeasonOver ? 'Finished 1st' : 'Leader'}
        value={leaders.length ? leaders.map((row) => row.squadName).join(', ') : 'Nobody yet'}
      />
      {mine ? (
        <MetricTile
          helperText={!leaders.length
            ? undefined
            : mine.position === 1 ? 'In the lead' : `${formatCupPoints(leaderPoints - mine.points, displayPreferences.locale)} behind`}
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
      : (
        <SectionCard testId="points-race-empty" title="No cups yet">
          <SectionEmpty>{`No sports league has two counted contests in ${year} yet.`}</SectionEmpty>
        </SectionCard>
      );
  }
  if (!cup) {
    return (
      <SectionCard
        footer={{ label: 'Trophy case', testId: 'points-race-trophy-case', to: buildLeagueTrophyCasePath(leagueCode, year) }}
        testId="points-race-no-cup"
        title="Cup not found"
      >
        <SectionEmpty>{`This league has no cup for that sports league in ${year}.`}</SectionEmpty>
      </SectionCard>
    );
  }
  const progress = cupProgress(cup);
  const isSeasonOver = isCupSeasonOver(cup, new Date());
  const isCrowned = cup.status === CupStatus.CROWNED;

  return (
    <div className="space-y-6" data-testid="points-race">
      <CupChips cups={cups.includes(cup) ? cups : [...cups, cup]} leagueCode={leagueCode} selectedId={cup.sportLeagueId} year={year} />
      <SectionCard
        info={isSeasonOver && !isCrowned ? 'This cup hasn\'t been crowned, so it has no trophies yet. These are its final standings.' : undefined}
        padded
        title={cup.name}
        titleTestId="points-race-cup-title"
        trailing={(
          <span data-testid="points-race-summary">
            {cup.sportLeagueName} · {cup.crownedAt
              ? `Crowned ${formatDateDisplay(cup.crownedAt, displayPreferences)}`
              : isSeasonOver ? 'Not crowned' : `${formatNumber(progress.final, displayPreferences.locale)} of ${formatNumber(progress.total, displayPreferences.locale)} contests final`}
          </span>
        )}
      >
        {isCrowned && hasPlanFeature(league, PlanFeature.CUP_CROWNING)
          ? <Podium focusSquadId={viewer.mySquadId} steps={buildPodium(cup.standings)} testId="cup-podium" />
          : null}
        <CupStatTiles cup={cup} isSeasonOver={isSeasonOver} mySquadId={viewer.mySquadId} />
        {projection && projectedBySquad ? (
          <SectionNote testId="cup-projection-note">{describeProjection(projection)}</SectionNote>
        ) : null}
        {projectionQuery.isError ? (
          <ErrorState body="We couldn't work out where teams would stand if the live contests ended now." size="inline" testId="cup-projection-error" />
        ) : null}
        <CupStandingsGrid
          focusSquadId={viewer.mySquadId}
          projection={projectedBySquad}
          rows={cup.standings}
          showMovement={!isSeasonOver}
          squadPath={squadPath}
        />
      </SectionCard>
      <SectionCard info="The top five, after each final contest." padded title="The race so far">
        <CupRaceChart focusSquadId={viewer.mySquadId} series={buildRaceSeries(cup)} />
      </SectionCard>
      <SectionCard title="Contests in this cup">
        <CupContestList contests={cup.contests} leagueCode={leagueCode} />
      </SectionCard>
    </div>
  );
}
