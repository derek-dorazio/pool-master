import { PlanFeature } from '@poolmaster/shared/domain';
import { buildLeaguePointsRacePath } from '@/features/leagues/league-routing';
import { hasPlanFeature } from '@/features/plans/plan-features';
import { PlanLockedNotice } from '@/features/plans/plan-locked-notice';
import { ErrorState, LoadingState, SectionCard, SectionEmpty, SectionRow, SectionRows, formatNumber, useDisplayPreferences } from '@/features/shared/ui';
import { CrownCupBanner } from './crown-cup-banner';
import { PerpetualTrophies } from './perpetual-trophies';
import { useChampionshipsRoute } from './use-championships-route';
import { cupProgress, cupsOnShow, describeCupStanding, isCupSeasonOver, isReadyToCrown } from './cup-view';
import { useSeasonCupsQuery } from './use-cups-query';

/**
 * Trophy case: a row per sports league cup of the year, with its leader or champion, the
 * viewer's place and, until its season is over, how many of its contests are final. The commissioner sees "Ready to crown" above for each cup that can be crowned.
 * Below them, every year, the league's perpetual trophies (#874). Each part the league's plan
 * lacks shows the locked note instead (#948).
 */
export function TrophyCasePage() {
  const { league, leagueCode, leagueId, viewer } = useChampionshipsRoute();
  return (
    <div className="space-y-6">
      {hasPlanFeature(league, PlanFeature.CUP_STANDINGS)
        ? <SeasonCups />
        : <PlanLockedNotice feature={PlanFeature.CUP_STANDINGS} isCommissioner={viewer.isCommissioner} leagueCode={leagueCode} />}
      {hasPlanFeature(league, PlanFeature.TROPHY_SHELF)
        ? <PerpetualTrophies leagueId={leagueId} />
        : <PlanLockedNotice feature={PlanFeature.TROPHY_SHELF} isCommissioner={viewer.isCommissioner} leagueCode={leagueCode} />}
    </div>
  );
}

function SeasonCups() {
  const { league, leagueCode, leagueId, viewer, year } = useChampionshipsRoute();
  const { locale } = useDisplayPreferences();
  const cupsQuery = useSeasonCupsQuery(leagueId, year);

  if (cupsQuery.isLoading) {
    return <LoadingState body="Loading cups..." />;
  }
  if (cupsQuery.isError) {
    return <ErrorState body="We couldn't load this year's cups." onRetry={() => void cupsQuery.refetch()} testId="trophy-case-error" />;
  }
  const cups = cupsOnShow(cupsQuery.data ?? []);
  const title = `${year} cups`;
  if (!cups.length) {
    return (
      <SectionCard info="Every sports league the league runs contests in gets its own cup, shown here once two of its contests have counted." title={title}>
        <SectionEmpty testId="trophy-case-empty">No cups yet.</SectionEmpty>
      </SectionCard>
    );
  }
  const now = new Date();

  return (
    <div className="space-y-4" data-testid="trophy-case">
      {viewer.isCommissioner && hasPlanFeature(league, PlanFeature.CUP_CROWNING)
        ? cups.filter(isReadyToCrown).map((cup) => <CrownCupBanner cup={cup} key={`crown-${cup.id}`} leagueId={leagueId} />)
        : null}
      <SectionCard title={title}>
        <SectionRows>
          {cups.map((cup) => {
            const progress = cupProgress(cup);
            return (
              <SectionRow
                facts={describeCupStanding(cup, { squadId: viewer.mySquadId, isViewer: true })}
                key={cup.id}
                name={cup.name}
                note={isCupSeasonOver(cup, now) ? undefined : `${formatNumber(progress.final, locale)} of ${formatNumber(progress.total, locale)} contests final`}
                testId={`cup-card-${cup.id}`}
                to={buildLeaguePointsRacePath(leagueCode, year, cup.sportLeagueId)}
              />
            );
          })}
        </SectionRows>
      </SectionCard>
    </div>
  );
}
