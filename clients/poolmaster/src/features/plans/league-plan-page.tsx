import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useParams } from 'react-router-dom';
import { PlanCap, PlanFeatureGroup, pluralize, type LeaguePlan } from '@poolmaster/shared/domain';
import { updateLeaguePlan, type LeagueDto, type LeaguePlanUsageResponse, type PlanEntitlementsDto } from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { useSportLeaguesQuery } from '@/features/contest-types/use-sport-leagues-query';
import { useAuth } from '@/features/auth/auth-context';
import { syncLeagueCaches } from '@/features/leagues/league-cache';
import { buildLeagueAdminPath } from '@/features/leagues/league-routing';
import { useLeagueContext } from '@/features/leagues/use-league-context';
import { Alert, Button, Chip, ErrorState, formatDateDisplay, LoadingState, PageHeader, SectionHeader, Tile } from '@/features/shared/ui';
import { PlanCards } from './plan-cards';
import { buildCapUsage, buildPlanChangeEffects, NAMED_CONTEST_LIMIT } from './plan-change';
import { PlanComparisonTable } from './plan-comparison-table';
import { buildFeatureLines } from './plan-highlights';
import { LEAGUE_PLAN_LABEL } from './plan-labels';
import { useLeaguePlanUsageQuery } from './use-league-plan-usage-query';
import { useLeaguePlansQuery } from './use-league-plans-query';

/**
 * The league's Plan page (#972): what the league is on and uses now, every plan's card with a
 * button to move there, and the comparison. Commissioners and root admins only; members never
 * see a plan named. Moving confirms inline first, naming what a lower plan would stop and hide.
 */
export function LeaguePlanPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const { league } = useLeagueContext(leagueCode);

  // The guard above this page has already loaded the league context.
  if (!league) {
    return null;
  }
  // An inactive league is read-only; its settings page says why Change is unavailable.
  if (!league.isActive) {
    return <Navigate replace to={buildLeagueAdminPath(league.leagueCode)} />;
  }
  return <LeaguePlanView key={league.id} league={league} />;
}

/** The old Choose a plan path (#945) now opens the Plan page. */
export function LeaguePlanEditRedirect() {
  return <Navigate replace to=".." relative="path" />;
}

function LeaguePlanView({ league }: { league: LeagueDto }) {
  const queryClient = useQueryClient();
  const plansQuery = useLeaguePlansQuery();
  const usageQuery = useLeaguePlanUsageQuery(league.id);
  const sportLeaguesQuery = useSportLeaguesQuery();
  const { isRootAdmin } = useAuth();
  const [choice, setChoice] = useState<LeaguePlan | null>(null);
  const current = league.planEntitlements;

  const saveMutation = useInvalidatingMutation({
    mutationFn: async (chosen: LeaguePlan) => {
      const response = await updateLeaguePlan({ path: { id: league.id }, body: { plan: chosen } });
      if (!response.data?.league) {
        throwApiError(response.error, 'Plan change response is missing data.');
      }
      return response.data.league;
    },
    onSuccess: (updated) => {
      syncLeagueCaches(queryClient, updated);
      setChoice(null);
    },
    // Root admin's league list shows each league's plan.
    invalidates: [QueryKeys.rootAdmin.manageLeagues],
  });

  const plans = plansQuery.data?.plans;
  const currentIndex = plans?.findIndex((plan) => plan.plan === current.plan) ?? -1;
  const chosen = plans?.find((plan) => plan.plan === choice) ?? null;
  const sportLeagueNames = new Map((sportLeaguesQuery.data ?? []).map((sportLeague) => [sportLeague.id, sportLeague.name]));

  const choose = (plan: LeaguePlan) => {
    saveMutation.reset();
    setChoice(plan);
  };

  return (
    <section className="space-y-8" data-testid="league-plan-page">
      <PageHeader
        description="What the league can do. Members never see which plan it is on."
        title="Plan"
      />

      <p className="text-sm text-muted-foreground" data-testid="league-plan-renews">
        Premium gifted for your preview period, until {formatDateDisplay(league.planRenewsAt)}.
      </p>

      <YourLeagueNow
        current={current}
        isError={usageQuery.isError}
        sportLeagueNames={sportLeagueNames}
        usage={usageQuery.data}
      />

      {plansQuery.isLoading ? (
        <LoadingState body="Loading the plans..." />
      ) : plansQuery.isError || !plans ? (
        <ErrorState body="We couldn't load the plans. Try again in a moment." title="Plans unavailable" />
      ) : (
        <>
          {chosen ? (
            <Tile className="space-y-4" data-testid="league-plan-confirm" padding="md" radius="md">
              <div className="space-y-1">
                <h3 className="font-semibold text-foreground">{`Move to ${LEAGUE_PLAN_LABEL[chosen.plan]}?`}</h3>
                <p className="text-sm text-muted-foreground">Plan changes are free for now, so this takes effect at once and costs nothing.</p>
              </div>
              {usageQuery.data ? (
                <PlanChangeWarnings
                  current={current}
                  sportLeagueNames={sportLeagueNames}
                  target={chosen}
                  usage={usageQuery.data}
                />
              ) : usageQuery.isError ? (
                <p className="text-sm text-muted-foreground" data-testid="league-plan-confirm-unchecked">
                  We couldn&apos;t check what this plan would stop. A lower plan never removes anything.
                </p>
              ) : null}
              {saveMutation.isError ? (
                <Alert data-testid="league-plan-confirm-error" tone="danger">
                  {extractErrorMessage(saveMutation.error, { fallback: 'We could not change the plan.' })}
                </Alert>
              ) : null}
              <div className="flex flex-wrap gap-3">
                <Button
                  data-testid="league-plan-confirm-save"
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate(chosen.plan)}
                >
                  {saveMutation.isPending ? 'Saving...' : `Move to ${LEAGUE_PLAN_LABEL[chosen.plan]}`}
                </Button>
                <Button
                  data-testid="league-plan-confirm-cancel"
                  disabled={saveMutation.isPending}
                  onClick={() => setChoice(null)}
                  variant="secondary"
                >
                  {`Keep ${LEAGUE_PLAN_LABEL[current.plan]}`}
                </Button>
              </div>
            </Tile>
          ) : null}

          <PlanCards
            plans={plans}
            renderAction={(plan) => {
              if (plan === current.plan) {
                return <Chip className="self-start" data-testid={`league-plan-card-${plan}-current`} tone="active">Your plan</Chip>;
              }
              // A plan not offered yet (Platinum) only a root admin may set.
              if (!isRootAdmin && plans.find((each) => each.plan === plan)?.commissionerSelectable === false) {
                return <Chip className="self-start" data-testid={`league-plan-card-${plan}-coming-soon`}>Coming soon</Chip>;
              }
              const isHigher = plans.findIndex((each) => each.plan === plan) > currentIndex;
              return (
                <Button
                  data-testid={`league-plan-card-${plan}-move`}
                  disabled={saveMutation.isPending}
                  onClick={() => choose(plan)}
                  variant={isHigher ? 'primary' : 'secondary'}
                >
                  {isHigher ? `Move up to ${LEAGUE_PLAN_LABEL[plan]}` : `Move to ${LEAGUE_PLAN_LABEL[plan]}`}
                </Button>
              );
            }}
          />

          <section className="space-y-4" data-testid="league-plan-compare">
            <SectionHeader description="Your plan is shaded. Where a plan's limit is below what your league uses now, it says so." title="Compare plans" />
            <PlanComparisonTable
              capUsage={usageQuery.data ? buildCapUsage(usageQuery.data) : undefined}
              currentPlan={current.plan}
              initiallyFolded={[PlanFeatureGroup.EMAILS]}
              plans={plans}
            />
          </section>
        </>
      )}

      <p className="text-xs text-muted-foreground" data-testid="league-plan-lower-note">
        A lower plan stops new entries and sports leagues past its limits, but never removes
        anything already made. Features it does not include are hidden, not deleted, and come back
        on a higher plan.
      </p>
    </section>
  );
}

/** A cap's use against its limit: "2 of 3", or the count alone when the plan has no limit. */
function formatUse(used: number, limit: number | null): string {
  return limit === null ? used.toLocaleString('en-US') : `${used.toLocaleString('en-US')} of ${limit.toLocaleString('en-US')}`;
}

function YourLeagueNow({
  current,
  isError,
  sportLeagueNames,
  usage,
}: {
  current: PlanEntitlementsDto;
  isError: boolean;
  sportLeagueNames: ReadonlyMap<string, string>;
  usage: LeaguePlanUsageResponse | undefined;
}) {
  const fullest = usage?.openContests.reduce<LeaguePlanUsageResponse['openContests'][number] | null>(
    (most, contest) => (most === null || contest.entryCount > most.entryCount ? contest : most),
    null,
  ) ?? null;
  return (
    <Tile className="space-y-3" data-testid="league-plan-now" padding="md" radius="md">
      <h3 className="font-semibold text-foreground">Your league now</h3>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">Plan</dt>
          <dd className="font-semibold text-foreground" data-testid="league-plan-now-plan">{LEAGUE_PLAN_LABEL[current.plan]}</dd>
        </div>
        {usage ? (
          <>
            <div>
              <dt className="text-muted-foreground">{`Sports leagues in ${usage.seasonYear}`}</dt>
              <dd className="text-foreground" data-testid="league-plan-now-sport-leagues">
                <span className="font-semibold">{formatUse(usage.sportLeagueIds.length, current.caps[PlanCap.SPORTS_LEAGUES_PER_YEAR])}</span>
                {usage.sportLeagueIds.length ? (
                  <span className="block text-muted-foreground">
                    {usage.sportLeagueIds.map((id) => sportLeagueNames.get(id) ?? 'A sports league').join(', ')}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Biggest open contest</dt>
              <dd className="text-foreground" data-testid="league-plan-now-entries">
                {fullest ? (
                  <>
                    <span className="font-semibold">{`${formatUse(fullest.entryCount, current.caps[PlanCap.ENTRIES_PER_CONTEST])} entries`}</span>
                    <span className="block text-muted-foreground">{fullest.name}</span>
                  </>
                ) : 'No contest is taking entries'}
              </dd>
            </div>
          </>
        ) : isError ? (
          <p className="text-sm text-muted-foreground sm:col-span-2" data-testid="league-plan-now-error">We couldn&apos;t load what the league uses now.</p>
        ) : (
          <p className="text-sm text-muted-foreground sm:col-span-2">Loading what the league uses...</p>
        )}
      </dl>
    </Tile>
  );
}

/** What moving to `target` would stop and hide (#972), following *Moving to a lower plan*. */
function PlanChangeWarnings({
  current,
  sportLeagueNames,
  target,
  usage,
}: {
  current: PlanEntitlementsDto;
  sportLeagueNames: ReadonlyMap<string, string>;
  target: PlanEntitlementsDto;
  usage: LeaguePlanUsageResponse;
}) {
  const effects = buildPlanChangeEffects(current, target, usage);
  const label = LEAGUE_PLAN_LABEL[target.plan];
  const named = effects.contestsOverEntries.slice(0, NAMED_CONTEST_LIMIT);
  const more = effects.contestsOverEntries.length - named.length;
  if (!effects.contestsOverEntries.length && !effects.sportLeaguesOver && !effects.hiddenFeatures.length) {
    return null;
  }
  return (
    <div className="space-y-3">
      {effects.entriesLimit !== null ? (
        <Alert data-testid="league-plan-confirm-entries" tone="warning">
          <ul className="space-y-1">
            {named.map((contest) => (
              <li key={contest.contestId}>{`${contest.name} has ${pluralize(contest.entryCount, 'entry', 'entries')}.`}</li>
            ))}
            {more > 0 ? <li>{`And ${more} more.`}</li> : null}
          </ul>
          <p className="mt-2">
            {`On ${label} ${effects.contestsOverEntries.length === 1 ? 'it keeps them' : 'each keeps them'} all, but takes no new entries past ${effects.entriesLimit.toLocaleString('en-US')}.`}
          </p>
        </Alert>
      ) : null}
      {effects.sportLeaguesOver ? (
        <Alert data-testid="league-plan-confirm-sport-leagues" tone="warning">
          {`This year's contests use ${pluralize(effects.sportLeaguesOver.used, 'sports league')}: ${usage.sportLeagueIds.map((id) => sportLeagueNames.get(id) ?? 'a sports league').join(', ')}. ${label} allows ${effects.sportLeaguesOver.limit.toLocaleString('en-US')} a year, so new contests this year can use only these.`}
        </Alert>
      ) : null}
      {effects.hiddenFeatures.length ? (
        <div className="text-sm" data-testid="league-plan-confirm-hidden">
          <p className="text-foreground">{`Hidden on ${label}, and back as they were when you move up again:`}</p>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {buildFeatureLines(effects.hiddenFeatures, false).map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
