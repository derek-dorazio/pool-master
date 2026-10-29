import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Navigate, useParams } from 'react-router';
import { buildEventPagePath, EventPageOfferState, getSportDefinition, sportHeaderImagePath } from '@poolmaster/shared/domain';
import type { EventPageDto, EventPageOfferDto } from '@/lib/api';
import { hasErrorCode } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useLeaguePlansQuery } from '@/features/plans/use-league-plans-query';
import {
  Breadcrumbs,
  Chip,
  cn,
  EmptyState,
  ErrorState,
  Eyebrow,
  formatDateDisplay,
  Heading,
  LinkButton,
  LoadingState,
  SectionHeader,
  Tile,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { withPrimaryOffer } from './event-page-offers';
import { EVENT_PAGE_ACTIONS, eventPageCopy, eventPageOfferCopy, type EventPageCopy } from './event-page-copy';
import { buildHowToPlaySportPath, sportFromPathSegment } from './event-page-paths';
import { buildStartPath, type StartRequest } from './start-path';
import { useEventPageQuery, useEventPagesQuery } from './use-event-pages-query';

/** The page's three steps to a running pool, as How to Play tells them. */
const READY_STEPS: readonly { title: string; body: string }[] = [
  { title: 'Start your league', body: 'Name it, and set up the contest you picked for this event.' },
  { title: 'Invite with one link', body: 'Send it to the group chat. Members join and make their picks on their phones.' },
  { title: 'Watch it live', body: 'The leaderboard moves with every score, and the final standings settle themselves.' },
];

/** Every button on the page starts the same way (#1008): `/start` decides where the visitor belongs. */
function StartButton({ request, testId, children, size, variant = 'primary' }: {
  request: StartRequest;
  testId: string;
  children: string;
  size?: 'sm';
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  return <LinkButton data-testid={testId} size={size} to={buildStartPath(request)} variant={variant}>{children}</LinkButton>;
}

function OfferCard({ copy, offer, page, testId }: { copy: EventPageCopy; offer: EventPageOfferDto; page: EventPageDto; testId: string }) {
  const request: StartRequest = { sport: page.sport, slug: page.slug, templateId: offer.template.id };
  const offerCopy = eventPageOfferCopy(copy, offer);
  const isOpen = offer.state === EventPageOfferState.OPEN;
  return (
    <Tile className={cn('flex flex-col gap-3', offer.isPrimary ? 'border-primary' : null)} data-testid={testId} padding="md" radius="md">
      {offerCopy.isNew ? <Chip className="self-start" tone="active">New</Chip> : null}
      <Heading level={3} variant="card" size="xl">{offerCopy.contestType}</Heading>
      <p className="text-sm font-semibold text-foreground">{`Starts as: ${offer.template.name}`}</p>
      <p className="text-sm text-muted-foreground">{offerCopy.line}</p>
      {offerCopy.facts.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {offerCopy.facts.map((fact) => <li key={fact}>{fact}</li>)}
        </ul>
      ) : null}
      <div className="mt-auto flex flex-col items-start gap-2 pt-2">
        {isOpen ? (
          <StartButton request={request} testId={`${testId}-start`} variant="secondary">{`Start with ${offerCopy.contestType}`}</StartButton>
        ) : (
          <>
            <Chip data-testid={`${testId}-opens`}>{`Opens ${offerCopy.opensWhen}`}</Chip>
            <StartButton request={request} size="sm" testId={`${testId}-start`} variant="ghost">
              Start your league now, we&apos;ll email you
            </StartButton>
          </>
        )}
      </div>
    </Tile>
  );
}

/** The slim bar a phone keeps at the bottom once the hero, and its button, have scrolled away. */
function useScrolledPast(target: RefObject<HTMLElement | null>): boolean {
  const [isPast, setIsPast] = useState(false);
  useEffect(() => {
    const element = target.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => setIsPast(!entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, [target]);
  return isPast;
}

function EventPageContent({ page }: { page: EventPageDto }) {
  const displayPreferences = useDisplayPreferences();
  const copy = eventPageCopy(page);
  const sportName = getSportDefinition(page.sport).name;
  const primary = page.offers.find((offer) => offer.isPrimary);
  const plansQuery = useLeaguePlansQuery();
  const sportPagesQuery = useEventPagesQuery(page.sport, { upcoming: true });
  // poolmaster-allow-list-lookup: the sport's few upcoming event pages, shown as what comes next
  const nextUp = withPrimaryOffer((sportPagesQuery.data ?? []).filter((other) => other.id !== page.id))
    .find(({ primary: other }) => primary === undefined || other.edition.startDate > primary.edition.startDate);
  const startRequest: StartRequest = { sport: page.sport, slug: page.slug, templateId: primary?.template.id ?? null };
  const hero = useRef<HTMLDivElement>(null);
  const showBar = useScrolledPast(hero);

  return (
    <section className="space-y-10 pb-20 md:pb-0" data-testid="event-page">
      <Tile className="overflow-hidden" padding="none" radius="lg">
        {/* The sport's photo, the same file that heads the email about its events. Decorative: the name below says what it shows. */}
        <img alt="" className="aspect-[5/2] w-full object-cover" data-testid="event-page-photo" height={480} src={sportHeaderImagePath(page.sport)} width={1200} />
        <div className="space-y-4 p-5 sm:p-8">
          <Breadcrumbs items={[{ label: 'How to Play', href: '/how-to-play' }, { label: sportName, href: buildHowToPlaySportPath(page.sport) }, { label: copy.name }]} />
          {copy.eyebrow ? <Eyebrow>{copy.eyebrow}</Eyebrow> : null}
          <Heading data-testid="event-page-name" level={1} variant="hero">{copy.name}</Heading>
          <p className="max-w-2xl text-base text-muted-foreground" data-testid="event-page-hook">{copy.hook}</p>
          {primary ? (
            <div className="flex flex-wrap gap-2" data-testid="event-page-when">
              <Chip>{formatDateDisplay(primary.edition.startDate, displayPreferences)}</Chip>
              <Chip>{copy.picksClose}</Chip>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="event-page-between-seasons">
              The next one is not on the schedule yet. Start your league now and you&apos;ll be ready when it is.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3" ref={hero}>
            <StartButton request={startRequest} testId="event-page-start">{EVENT_PAGE_ACTIONS.start}</StartButton>
          </div>
          {plansQuery.data ? (
            <Chip data-testid="event-page-gift" tone="active">
              {`Every new league gets Premium free for a ${plansQuery.data.previewPeriodMonths}-month preview period`}
            </Chip>
          ) : null}
        </div>
      </Tile>

      {page.offers.length > 0 ? (
        <section className="space-y-4" data-testid="event-page-offers">
          <SectionHeader description="Pick one, or run them all. Each starts with the setup below, and you can change any rule." title={`Ways to play ${copy.name}`} />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {page.offers.map((offer) => (
              <OfferCard copy={copy} key={offer.id} offer={offer} page={page} testId={`event-page-offer-${offer.template.templateKey}`} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-4" data-testid="event-page-steps">
        <SectionHeader title="Ready before kickoff" />
        <ol className="grid gap-4 md:grid-cols-3">
          {READY_STEPS.map((step, index) => (
            <li className="list-none" key={step.title}>
              <Tile className="h-full" padding="md" radius="md">
                <p className="font-display text-2xl font-bold text-primary">{index + 1}</p>
                <Heading level={3} variant="card">{step.title}</Heading>
                <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
              </Tile>
            </li>
          ))}
        </ol>
      </section>

      {nextUp ? (
        <Tile className="flex flex-wrap items-center justify-between gap-4" data-testid="event-page-next-up" padding="md" radius="md">
          <div>
            <Eyebrow>Next up</Eyebrow>
            <Heading level={2} variant="card" size="xl">{eventPageCopy(nextUp.page).name}</Heading>
          </div>
          <LinkButton to={buildEventPagePath(nextUp.page.sport, nextUp.page.slug)} variant="secondary">See ways to play</LinkButton>
        </Tile>
      ) : null}

      <p className="text-xs text-muted-foreground" data-testid="event-page-disclaimer">{`Not affiliated with ${copy.leagueName} or any sports league.`}</p>

      {showBar ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card p-3 md:hidden" data-testid="event-page-bar">
          <StartButton request={startRequest} testId="event-page-bar-start">{EVENT_PAGE_ACTIONS.start}</StartButton>
        </div>
      ) : null}
    </section>
  );
}

function MovedPage() {
  return (
    <EmptyState
      action={<LinkButton to="/how-to-play">{EVENT_PAGE_ACTIONS.seeEveryWayToPlay}</LinkButton>}
      body="This event page has moved. How to Play lists every sport and what's coming up."
      testId="event-page-moved"
      title="This page has moved"
    />
  );
}

/**
 * An event page (#1007, boards 1 and 2), open to every visitor: one event a fan would name and
 * its ways to play, each with when it opens. A retired page goes to its successor, or says it
 * has moved; an address with no page says so too, so an old ad link never dead-ends.
 */
export function EventPage() {
  const logger = useMemo(() => getLogger().child({ feature: 'event-page' }), []);
  const params = useParams<'sport' | 'pageSlug'>();
  const sport = sportFromPathSegment(params.sport);
  const pageQuery = useEventPageQuery(sport, params.pageSlug);
  const isNotFound = sport === null || hasErrorCode(pageQuery.error, 'EVENT_PAGE_NOT_FOUND');

  useEffect(() => {
    if (pageQuery.isError && !isNotFound) {
      logger.warn({ action: 'eventPage.get.failed', err: pageQuery.error }, 'Event page failed to load');
    }
  }, [isNotFound, logger, pageQuery.error, pageQuery.isError]);

  if (isNotFound) {
    return <MovedPage />;
  }
  if (pageQuery.isLoading) {
    return <LoadingState body="Loading the event..." />;
  }
  if (pageQuery.isError || !pageQuery.data) {
    return <ErrorState body="We couldn't load this event. Try again in a moment." testId="event-page-error" title="Event unavailable" />;
  }
  const page = pageQuery.data;
  if (!page.isActive) {
    return page.redirectTo ? <Navigate replace to={buildEventPagePath(page.redirectTo.sport, page.redirectTo.slug)} /> : <MovedPage />;
  }
  return <EventPageContent page={page} />;
}
