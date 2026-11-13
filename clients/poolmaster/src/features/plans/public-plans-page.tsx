import { useEffect, useMemo } from 'react';
import { PlanFeatureGroup } from '@poolmaster/shared/domain';
import { useAuth } from '@/features/auth/auth-context';
import { buildLeagueAdminPlanPath } from '@/features/leagues/league-routing';
import { useLeaguesQuery } from '@/features/leagues/use-leagues-query';
import { LandingSection } from '@/features/event-pages/components/landing-section';
import { Chip, ErrorState, FaqList, LinkButton, LoadingState, PageHeader, SectionCard } from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { PlanCards } from './plan-cards';
import { PlanComparisonTable } from './plan-comparison-table';
import { previewOffer } from './preview-offer';
import { useLeaguePlansQuery } from './use-league-plans-query';

/** The questions under the comparison: who picks a plan, and what a plan does and doesn't limit. */
const QUESTIONS: readonly { question: string; answer: string }[] = [
  {
    question: 'Who chooses the plan?',
    answer: 'A league\'s commissioners choose its plan in league settings. Members never need one, and never see which plan the league is on.',
  },
  {
    question: 'What happens if we move to a lower plan?',
    answer: 'Nothing you already have is removed. A full contest stops taking new entries, and features the plan doesn\'t include are hidden until you move back up, with everything kept.',
  },
  {
    question: 'Is there a limit on members?',
    answer: 'No. Invite as many people as you like on every plan. Plans set how many entries each contest takes.',
  },
  {
    question: 'What is a sports league?',
    answer: 'The PGA TOUR, the NFL, the NBA and so on. Each plan sets how many sports leagues its contests can use in a year.',
  },
];

/** What every plan has, as the header's fact line. */
const EVERY_PLAN = 'Every plan: every contest type, live leaderboards, unlimited members';

/** Where a signed-in visitor chooses a plan: the plan page of the one league they run, else their leagues. */
function useChoosePlanPath(isAuthenticated: boolean): string {
  const { leagues, commissionerLeagueIds } = useLeaguesQuery({ enabled: isAuthenticated });
  const commissioned = (leagues ?? []).filter((league) => commissionerLeagueIds.has(league.id));
  return commissioned.length === 1 ? buildLeagueAdminPlanPath(commissioned[0].leagueCode) : '/my-leagues';
}

/**
 * Plans (#973): open to every visitor. Each plan's card and the full comparison, built from the
 * plan settings through the public plan list, so a change on the root admin Plans page shows
 * here at once. There are no plan prices yet, so every plan is free and every button starts free;
 * each card lists its contest expansion prices, and a plan not offered yet says Coming soon.
 * Start free leads the header (#1614). While the plan list offers a preview, the gifted plan's
 * offer leads the fact line and its column is tinted in the comparison; without one, neither shows.
 */
export function PublicPlansPage() {
  const logger = useMemo(() => getLogger().child({ feature: 'public-plans-page' }), []);
  const auth = useAuth();
  const plansQuery = useLeaguePlansQuery();
  const choosePlanPath = useChoosePlanPath(auth.isAuthenticated);

  useEffect(() => {
    if (plansQuery.isError) {
      logger.warn({ action: 'publicPlans.list.failed', err: plansQuery.error }, 'Plans page failed to load the plans');
    }
  }, [logger, plansQuery.error, plansQuery.isError]);

  const action = (testId: string) => auth.isAuthenticated ? (
    <LinkButton data-testid={testId} to={choosePlanPath}>Choose for a league</LinkButton>
  ) : (
    <LinkButton data-testid={testId} state={{ authMode: 'register' }} to="/">Start free</LinkButton>
  );

  const offer = plansQuery.data ? previewOffer(plansQuery.data) : null;

  return (
    <section className="space-y-8" data-testid="public-plans-page">
      <PageHeader
        actions={action('public-plans-start')}
        meta={offer ? `${offer} · ${EVERY_PLAN}` : EVERY_PLAN}
        testId="public-plans-header"
        title="Plans"
      />

      {plansQuery.isLoading ? (
        <LoadingState body="Loading the plans..." />
      ) : plansQuery.isError || !plansQuery.data ? (
        <ErrorState body="We couldn't load the plans." onRetry={() => void plansQuery.refetch()} />
      ) : (
        <>
          <PlanCards
            expansion={plansQuery.data}
            plans={plansQuery.data.plans}
            renderAction={(plan) => plansQuery.data.plans.find((each) => each.plan === plan)?.commissionerSelectable === false ? (
              <Chip className="self-start" data-testid={`public-plans-card-${plan}-coming-soon`}>Coming soon</Chip>
            ) : action(`public-plans-card-${plan}-start`)}
          />
          <SectionCard testId="public-plans-compare" title="Compare plans">
            <PlanComparisonTable highlightedPlan={plansQuery.data.previewPlan} initiallyFolded={[PlanFeatureGroup.EMAILS]} plans={plansQuery.data.plans} />
          </SectionCard>
        </>
      )}

      <SectionCard testId="public-plans-questions" title="Questions">
        <FaqList items={QUESTIONS} testId="public-plans-question" />
      </SectionCard>

      {auth.isAuthenticated ? null : (
        <LandingSection testId="public-plans-cta" title="Start your league today">
          {action('public-plans-start-footer')}
        </LandingSection>
      )}
    </section>
  );
}
