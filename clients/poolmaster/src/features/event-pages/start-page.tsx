import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { buildEventPagePath, PlanCap } from '@poolmaster/shared/domain';
import type { EventPageDto, EventPageOfferDto, LeagueDto } from '@/lib/api';
import { hasErrorCode } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useAuth } from '@/features/auth/auth-context';
import { useLeagueContestsQuery } from '@/features/contests/use-league-contests-query';
import { CreateLeagueModal } from '@/features/leagues/create-league-modal';
import { LeagueIcon } from '@/features/leagues/league-icon';
import { buildLeagueAdminContestPath, buildLeagueAdminPlanPath } from '@/features/leagues/league-routing';
import { useLeaguesQuery } from '@/features/leagues/use-leagues-query';
import { sportLeaguesUsedQuery } from '@/features/plans/use-sport-leagues-used';
import { Button, EmptyState, ErrorState, LinkButton, LoadingState, Tile } from '@/features/shared/ui';
import { EVENT_PAGE_ACTIONS, eventPageCopy, eventPageOfferCopy } from './event-page-copy';
import { buildStartDestination, parseStartRequest, type StartRequest } from './start-path';
import { useEventPageQuery } from './use-event-pages-query';

/**
 * What a league can do with the offer: start it, open the contest it already has, or not this
 * year. No action shows until both checks have answered, so Set up never shows on a guess.
 */
function PickerRow({ league, offer, page, request }: { league: LeagueDto; offer: EventPageOfferDto | null; page: EventPageDto; request: StartRequest }) {
  const copy = eventPageCopy(page);
  const logger = useMemo(() => getLogger().child({ feature: 'start-page' }), []);
  const contestsQuery = useLeagueContestsQuery(offer ? league.id : '');
  const cap = league.planEntitlements.caps[PlanCap.SPORTS_LEAGUES_PER_YEAR];
  const year = offer?.edition.eventYear ?? 0;
  const isCapCounted = offer !== null && cap !== null;
  const usedQuery = useQuery({ ...sportLeaguesUsedQuery(league.id, year), enabled: isCapCounted });
  const isChecking = (offer !== null && contestsQuery.isPending) || (isCapCounted && usedQuery.isPending);
  const checkError = offer !== null ? contestsQuery.error ?? (isCapCounted ? usedQuery.error : null) : null;
  const testId = `start-league-${league.leagueCode}`;

  useEffect(() => {
    if (checkError) {
      logger.warn({ action: 'start.picker.check.failed', data: { leagueId: league.id }, err: checkError }, 'Start could not check a league against the offer');
    }
  }, [checkError, league.id, logger]);

  const existing = offer
    ? (contestsQuery.data ?? []).find((contest) => contest.selectionType === offer.template.selectionType
      && contest.sportEvents.some((event) => event.sportEventId === offer.edition.sportEventId))
    : undefined;
  const used = usedQuery.data?.sportLeagueIds;
  const isCapped = offer !== null && cap !== null && used !== undefined && used.length >= cap && !used.includes(offer.sportLeagueId);

  const [description, action] = checkError
    ? ['We couldn\'t check this league. Try again in a moment.', null]
    : isChecking
      ? ['Checking this league...', null]
      : existing && offer
        ? [
          `Already has a ${eventPageOfferCopy(copy, offer).contestType} on ${copy.name}`,
          <LinkButton data-testid={`${testId}-view`} key="view" size="sm" to={buildLeagueAdminContestPath(league.leagueCode, existing.id)} variant="secondary">View</LinkButton>,
        ]
        : isCapped
          ? [
            `Your plan's ${String(cap)} sports leagues for ${String(year)} are used`,
            <LinkButton data-testid={`${testId}-plans`} key="plans" size="sm" to={buildLeagueAdminPlanPath(league.leagueCode)} variant="secondary">See plans</LinkButton>,
          ]
          : [
            null,
            <LinkButton data-testid={`${testId}-set-up`} key="set-up" size="sm" to={buildStartDestination(league.leagueCode, request, offer)}>Set up</LinkButton>,
          ];

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-4" data-testid={testId}>
      <LeagueIcon iconKey={league.iconKey} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">{league.name}</p>
        {description ? <p className="text-sm text-muted-foreground" data-testid={`${testId}-status`}>{description}</p> : null}
      </div>
      {action}
    </li>
  );
}

/** Copies the event page's link, for a member to send whoever runs their league. */
function ShareWithCommissionerButton({ page }: { page: EventPageDto }) {
  const [copyState, setCopyState] = useState<'copied' | 'failed' | 'idle'>('idle');
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${buildEventPagePath(page.sport, page.slug)}`);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }
  return (
    <div className="space-y-1">
      <Button data-testid="start-share-with-commissioner" onClick={() => void copyLink()} type="button" variant="secondary">
        {copyState === 'copied' ? 'Link copied' : 'Share with your commissioner'}
      </Button>
      {copyState === 'failed' ? (
        <p className="text-sm text-destructive" data-testid="start-share-failed" role="alert">
          {'Couldn\'t copy the link. Copy this page\'s address from your browser instead.'}
        </p>
      ) : null}
    </div>
  );
}

function StartForUser({ request }: { request: StartRequest }) {
  const navigate = useNavigate();
  const logger = useMemo(() => getLogger().child({ feature: 'start-page' }), []);
  const pageQuery = useEventPageQuery(request.sport, request.slug);
  const { query: leaguesQuery, leagues, commissionerLeagueIds } = useLeaguesQuery();
  const [isCreating, setIsCreating] = useState<boolean | null>(null);

  useEffect(() => {
    if (pageQuery.isError || leaguesQuery.isError) {
      logger.warn({ action: 'start.load.failed', err: pageQuery.error ?? leaguesQuery.error }, 'Start could not load the page or the leagues');
    }
  }, [leaguesQuery.error, leaguesQuery.isError, logger, pageQuery.error, pageQuery.isError]);

  if (hasErrorCode(pageQuery.error, 'EVENT_PAGE_NOT_FOUND')) {
    return <IncompleteLink />;
  }
  if (pageQuery.isError || leaguesQuery.isError) {
    return <ErrorState body="Try again in a moment." testId="start-error" title="We couldn't load this page." />;
  }
  if (!pageQuery.data || !leagues) {
    return <LoadingState body="Getting your league ready..." testId="start-loading" />;
  }

  const page = pageQuery.data;
  const copy = eventPageCopy(page);
  const offer = request.templateId
    ? page.offers.find((candidate) => candidate.template.id === request.templateId) ?? null
    : null;
  if (request.templateId && !offer) {
    return (
      <EmptyState
        action={<LinkButton to={buildEventPagePath(page.sport, page.slug)}>{`See ways to play ${copy.name}`}</LinkButton>}
        body="That way to play has already started. The event page shows what you can still start."
        testId="start-offer-gone"
        title="This one has started"
      />
    );
  }

  const runs = leagues.filter((league) => league.isActive && commissionerLeagueIds.has(league.id));
  const runsOnlyInactive = !runs.length && leagues.some((league) => commissionerLeagueIds.has(league.id));
  if (runs.length === 1) {
    return <Navigate replace to={buildStartDestination(runs[0].leagueCode, request, offer)} />;
  }

  const offerLabel = offer ? `${eventPageOfferCopy(copy, offer).contestType}: ${offer.template.name}` : copy.name;
  // A new visitor goes straight to naming their league; one with leagues chooses first.
  const showCreate = isCreating ?? leagues.length === 0;

  return (
    <section className="mx-auto max-w-2xl space-y-6" data-testid="start-page">
      <Tile className="space-y-4" padding="lg" radius="lg">
        <p className="text-xs font-semibold uppercase text-muted-foreground">{`You're starting a ${copy.name} pool`}</p>
        <h1 className="font-display text-3xl font-bold text-foreground">
          {runs.length ? 'Which league is it for?' : 'Start your own league'}
        </h1>
        <p className="text-sm text-muted-foreground" data-testid="start-offer">{offerLabel}</p>
        {runs.length ? (
          <ul className="space-y-3" data-testid="start-league-picker">
            {runs.map((league) => <PickerRow key={league.id} league={league} offer={offer} page={page} request={request} />)}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {runsOnlyInactive
              ? 'The leagues you run are inactive. Reactivate one from its settings, or start a new league for this.'
              : leagues.length
                ? 'Contests are started by a league\'s commissioner. Start a league of your own, or send this page to whoever runs yours.'
                : 'Name your league, then set up the contest. Nothing is created until you press Create.'}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button data-testid="start-new-league" onClick={() => setIsCreating(true)} type="button" variant={runs.length ? 'secondary' : 'primary'}>
            {runs.length ? 'Start a new league instead' : 'Start your own league'}
          </Button>
          {leagues.length > 0 ? <ShareWithCommissionerButton page={page} /> : null}
        </div>
        {runs.length ? (
          <p className="text-xs text-muted-foreground">Only leagues where you are a commissioner are listed.</p>
        ) : null}
      </Tile>
      <CreateLeagueModal
        isOpen={showCreate}
        nextStep={offer ? `your ${eventPageOfferCopy(copy, offer).contestType} for ${copy.name}` : `contests for ${copy.name}`}
        onClose={() => setIsCreating(false)}
        onCreated={(leagueCode) => void navigate(buildStartDestination(leagueCode, request, offer), { replace: true })}
      />
    </section>
  );
}

function IncompleteLink() {
  return (
    <EmptyState
      action={<LinkButton to="/how-to-play">{EVENT_PAGE_ACTIONS.seeEveryWayToPlay}</LinkButton>}
      body="This start link is missing its event. How to Play lists every sport and what's coming up."
      testId="start-incomplete"
      title="We couldn't tell what to start"
    />
  );
}

/**
 * `/start` (#1008, boards 3 and 5): where every event page button goes. It decides where the
 * visitor belongs: sign-up first for a visitor, then their one league's Create contest, a picker
 * of the leagues they run, or a new league. Nothing is created until they press Create.
 */
export function StartPage() {
  const auth = useAuth();
  const location = useLocation();
  const request = useMemo(() => parseStartRequest(location.search), [location.search]);

  if (!request) {
    return <IncompleteLink />;
  }
  if (auth.isLoading) {
    return <LoadingState body="Getting your league ready..." testId="start-loading" />;
  }
  if (!auth.isAuthenticated) {
    // The choice rides in the return path, held in this tab's history: sign-up and a refresh keep
    // it, a second tab does not.
    return <Navigate replace state={{ authMode: 'register', from: `${location.pathname}${location.search}` }} to="/" />;
  }
  return <StartForUser request={request} />;
}

