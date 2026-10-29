import { useEffect, useMemo } from 'react';
import { PlanFeatureGroup } from '@poolmaster/shared/domain';
import { useAuth } from '@/features/auth/auth-context';
import { buildLeagueAdminPlanPath } from '@/features/leagues/league-routing';
import { useLeaguesQuery } from '@/features/leagues/use-leagues-query';
import {
  Chip,
  ErrorState,
  Heading,
  LinkButton,
  LoadingState,
  PageHeader,
  SectionHeader,
  Tile,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { PlanCards } from './plan-cards';
import { PlanComparisonTable } from './plan-comparison-table';
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

  return (
    <section className="space-y-8" data-testid="public-plans-page">
      <PageHeader
        actions={action('public-plans-start')}
        description="Every plan runs every contest type, with live leaderboards and as many members as you can invite. Higher plans give you bigger contests, more sports and the history that brings your league back each year."
        title="Plans"
      />

      {plansQuery.data ? (
        <Chip data-testid="public-plans-free-note" tone="active">
          {`Every new league gets Premium free for a ${plansQuery.data.previewPeriodMonths}-month preview period`}
        </Chip>
      ) : null}

      {plansQuery.isLoading ? (
        <LoadingState body="Loading the plans..." />
      ) : plansQuery.isError || !plansQuery.data ? (
        <ErrorState body="We couldn't load the plans. Try again in a moment." title="Plans unavailable" />
      ) : (
        <>
          <PlanCards
            expansion={plansQuery.data}
            plans={plansQuery.data.plans}
            renderAction={(plan) => plansQuery.data.plans.find((each) => each.plan === plan)?.commissionerSelectable === false ? (
              <Chip className="self-start" data-testid={`public-plans-card-${plan}-coming-soon`}>Coming soon</Chip>
            ) : action(`public-plans-card-${plan}-start`)}
          />
          <section className="space-y-4" data-testid="public-plans-compare">
            <SectionHeader description="Each row lines up across the plans. Open a group to see every item in it." title="Compare every plan" />
            <PlanComparisonTable initiallyFolded={[PlanFeatureGroup.EMAILS]} plans={plansQuery.data.plans} />
          </section>
        </>
      )}

      <section className="space-y-3" data-testid="public-plans-questions">
        <SectionHeader title="Questions" />
        {QUESTIONS.map((item) => (
          <Tile key={item.question} padding="sm" radius="md">
            <details>
              <summary className="cursor-pointer font-semibold text-foreground">{item.question}</summary>
              <p className="mt-2 text-sm text-muted-foreground">{item.answer}</p>
            </details>
          </Tile>
        ))}
      </section>

      {auth.isAuthenticated ? null : (
        <Tile className="flex flex-wrap items-center justify-between gap-4" padding="md" radius="md">
          <div>
            <Heading level={3} variant="card">Start your league today</Heading>
            <p className="text-sm text-muted-foreground">Set up a league, invite your office, and open your first contest in minutes.</p>
          </div>
          {action('public-plans-start-footer')}
        </Tile>
      )}
    </section>
  );
}
