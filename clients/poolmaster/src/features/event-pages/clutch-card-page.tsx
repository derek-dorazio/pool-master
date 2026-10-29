import { useEffect, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { buildEventPagePath, EventPageOfferState, getSportDefinition, ScoringFamily, Sport } from '@poolmaster/shared/domain';
import type { EventPageDto, EventPageOfferDto, SportLeagueDto } from '@/lib/api';
import { getLogger } from '@/lib/logger';
import { STAT_POOL_CONTEST_TYPE, STAT_POOL_FORMULAS } from '@/features/contests/scoring-family-ui/stat-pool-copy';
import { useSportLeaguesQuery } from '@/features/contest-types/use-sport-leagues-query';
import {
  Chip,
  cn,
  ErrorState,
  Eyebrow,
  Heading,
  LinkButton,
  LoadingState,
  Tile,
} from '@/features/shared/ui';
import { EVENT_PAGE_ACTIONS } from './event-page-copy';
import { CLUTCH_CARD_EXAMPLE, CLUTCH_CARD_PAGE, CLUTCH_CARD_SECTIONS, type ClutchCardRound, type ClutchCardSectionId } from './clutch-card-copy';
import { buildStartPath, type StartRequest } from './start-path';
import { useEventPagesQuery } from './use-event-pages-query';

/** The built stat lines, in the order the copy tells them: each sport's composite name and formula. */
const BUILT_STAT_LINE_SPORTS: readonly Sport[] = [Sport.BASEBALL, Sport.BASKETBALL, Sport.HOCKEY, Sport.AMERICAN_FOOTBALL, Sport.SOCCER];

/** A sport's stat line name: its composite's. */
function statLineName(sport: Sport): string | undefined {
  return getSportDefinition(sport).composite?.name;
}

/** A section's heading row: its eyebrow, title and intro, and the address its menu link jumps to. */
function Section({ id, eyebrow, title, intro, testId, children }: {
  id?: ClutchCardSectionId;
  eyebrow: string;
  title: string;
  intro?: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section className="scroll-mt-6 space-y-4" data-testid={testId} id={id}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <div className="space-y-2">
        <Heading level={2} variant="display">{title}</Heading>
        {intro ? <p className="max-w-2xl text-base text-muted-foreground">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** A title round on the calendar: available while its stat pool sport league is, and its event page when one offers it. */
interface CalendarRound {
  round: ClutchCardRound;
  isAvailable: boolean;
  eventPage: EventPageDto | null;
}

/** A stat pool sport league's key: its sport and name, so a same-named league in another sport never matches. */
function roundKey(sport: string, name: string): string {
  return `${sport}:${name}`;
}

function statPoolLeagueByRound(sportLeagues: readonly SportLeagueDto[]): Map<string, SportLeagueDto> {
  return new Map(sportLeagues
    .filter((league) => league.isActive && league.scoringFamily === ScoringFamily.COMPOSITE)
    .map((league) => [roundKey(league.sport, league.name), league]));
}

function eventPageFor(league: SportLeagueDto | undefined, pages: readonly EventPageDto[]): EventPageDto | null {
  return league ? pages.find((page) => page.offers.some((offer) => offer.sportLeagueId === league.id)) ?? null : null;
}

/**
 * Where the page's start buttons go: the event page offer on a stat pool sport league that opens
 * soonest, an open one first; none while no event page offers a Clutch Card.
 */
function startRequestFor(statPoolLeagues: ReadonlyMap<string, SportLeagueDto>, pages: readonly EventPageDto[]): StartRequest | null {
  const statPoolLeagueIds = new Set([...statPoolLeagues.values()].map((league) => league.id));
  const offers = pages
    .flatMap((page) => page.offers.map((offer) => ({ page, offer })))
    .filter(({ offer }) => statPoolLeagueIds.has(offer.sportLeagueId))
    .sort((a, b) => rankOffer(a.offer) - rankOffer(b.offer) || a.offer.edition.startDate.localeCompare(b.offer.edition.startDate));
  const first = offers.at(0);
  return first ? { sport: first.page.sport, slug: first.page.slug, templateId: first.offer.template.id } : null;
}

function rankOffer(offer: EventPageOfferDto): number {
  return offer.state === EventPageOfferState.OPEN ? 0 : 1;
}

function StartButton({ request, testId }: { request: StartRequest | null; testId: string }) {
  if (!request) {
    return null;
  }
  return <LinkButton data-testid={testId} size="lg" to={buildStartPath(request)}>{CLUTCH_CARD_PAGE.hero.start}</LinkButton>;
}

/** The hero's made-up card, mid-series: each star's games, the best ones counted. */
function ExampleCard() {
  const example = CLUTCH_CARD_EXAMPLE;
  const stars = example.stars.map((star) => ({ ...star, total: star.scores.reduce((sum, score) => sum + score, 0) }));
  const counted = new Set([...stars].sort((a, b) => b.total - a.total).slice(0, example.counted).map((star) => star.tier));
  const cardTotal = stars.filter((star) => counted.has(star.tier)).reduce((sum, star) => sum + star.total, 0);
  return (
    <Tile data-testid="clutch-card-example" padding="sm" radius="md" variant="inverseDeep">
      <div className="flex items-center justify-between gap-2">
        <p className="font-display font-bold">{example.name}</p>
        <Chip tone="brand">{example.status}</Chip>
      </div>
      <p className="mt-1 text-xs text-on-inverse-muted">{statLineName(example.sport)}</p>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-xs text-on-inverse-muted">
            <th className="py-1 text-left font-medium">Star</th>
            {example.games.map((game) => <th className="py-1 text-right font-medium" key={game}>{game}</th>)}
            <th className="py-1 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {stars.map((star) => (
            <tr className={cn('border-t border-inverse-border', counted.has(star.tier) ? null : 'text-on-inverse-muted')} key={star.tier}>
              <td className="py-1.5">
                <span className="mr-2 font-mono text-xs text-primary">{star.tier}</span>
                {`${star.position}, ${star.team}`}
              </td>
              {star.scores.map((score, index) => <td className="py-1.5 text-right font-mono" key={example.games[index]}>{score}</td>)}
              <td className="py-1.5 text-right font-mono font-semibold">{star.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-center justify-between border-t border-inverse-border pt-3">
        <p className="text-sm text-on-inverse-muted">{example.rank}</p>
        <div className="text-right">
          <p className="text-xs text-on-inverse-muted">{`Best ${example.counted} of ${stars.length} count`}</p>
          <p className="font-display text-2xl font-bold text-primary" data-testid="clutch-card-example-total">{cardTotal}</p>
        </div>
      </div>
      <p className="mt-2 text-xs text-on-inverse-muted" data-testid="clutch-card-example-note">
        {`${example.note} ${statLineName(example.sport) ?? ''} = ${STAT_POOL_FORMULAS[example.sport] ?? ''}, each game.`}
      </p>
    </Tile>
  );
}

function Hero({ startRequest }: { startRequest: StartRequest | null }) {
  const hero = CLUTCH_CARD_PAGE.hero;
  return (
    <Tile as="section" className="grid gap-x-12 gap-y-8 p-6 sm:p-10 lg:grid-cols-2 lg:items-center" data-testid="clutch-card-hero" padding="none" radius="md" variant="inverse">
      <div className="space-y-3 lg:col-span-2">
        <div className="flex items-center gap-2">
          <Chip tone="brand">{hero.badge}</Chip>
          <Eyebrow tone="inverse">{hero.eyebrow}</Eyebrow>
        </div>
        <Heading data-testid="clutch-card-tagline" level={1} tone="inherit" variant="hero">
          {hero.tagline[0]}
          <br />
          <span className="text-primary">{hero.tagline[1]}</span>
        </Heading>
      </div>
      <div className="space-y-5">
        <p className="max-w-xl text-lg text-on-inverse-muted" data-testid="clutch-card-hook">{hero.hook}</p>
        <div className="flex flex-wrap items-center gap-3">
          <StartButton request={startRequest} testId="clutch-card-start" />
          <a className="text-sm font-semibold underline underline-offset-4" data-testid="clutch-card-see-cards" href="#card-types">{hero.seeTheCards}</a>
        </div>
        <p className="text-sm text-on-inverse-muted">{hero.note}</p>
      </div>
      <ExampleCard />
    </Tile>
  );
}

function CardTypes() {
  const copy = CLUTCH_CARD_PAGE.cardTypes;
  return (
    <Section eyebrow={copy.eyebrow} id="card-types" intro={copy.intro} testId="clutch-card-types" title={copy.title}>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {BUILT_STAT_LINE_SPORTS.map((sport) => (
          <Tile data-testid={`clutch-card-type-${sport}`} key={sport} padding="none" radius="md" className="p-5" variant="inverse">
            <Eyebrow tone="inverse">{getSportDefinition(sport).name}</Eyebrow>
            <Heading level={3} variant="card" size="xl" tone="primary">{statLineName(sport)}</Heading>
            <p className="mt-2 font-mono text-sm">{STAT_POOL_FORMULAS[sport]}</p>
            <p className="mt-2 text-sm text-on-inverse-muted">{copy.lines[sport]}</p>
          </Tile>
        ))}
      </div>
    </Section>
  );
}

function RoundChip({ round }: { round: CalendarRound }) {
  const testId = `clutch-card-round-${roundKey(round.round.sport, round.round.sportLeague)}`;
  const label = (
    <>
      {round.round.sportLeague}
      <span className="ml-2 text-xs font-normal text-muted-foreground">{statLineName(round.round.sport)}</span>
    </>
  );
  if (!round.isAvailable) {
    return <Chip className="text-sm" data-testid={testId} tone="placeholder">{label}</Chip>;
  }
  return round.eventPage ? (
    <Chip asChild className="text-sm hover:bg-primary/20" tone="brandTint">
      <Link data-testid={testId} to={buildEventPagePath(round.eventPage.sport, round.eventPage.slug)}>{label}</Link>
    </Chip>
  ) : (
    <Chip className="text-sm" data-testid={testId} tone="brandTint">{label}</Chip>
  );
}

function Calendar({ rounds }: { rounds: ReadonlyMap<string, CalendarRound> | null }) {
  const copy = CLUTCH_CARD_PAGE.calendar;
  return (
    <Section eyebrow={copy.eyebrow} id="calendar" intro={copy.intro} testId="clutch-card-calendar" title={copy.title}>
      {rounds ? (
        <>
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {copy.months.map((month) => (
              <li className="grid gap-2 p-4 sm:grid-cols-[8rem_1fr] sm:items-center" key={month.month}>
                <p className="font-display font-bold text-foreground">{month.month}</p>
                <div className="flex flex-wrap gap-2">
                  {month.rounds.map((round) => {
                    const key = roundKey(round.sport, round.sportLeague);
                    const calendarRound = rounds.get(key);
                    return calendarRound ? <RoundChip key={key} round={calendarRound} /> : null;
                  })}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border border-primary bg-primary/10" />{copy.legend.available}</span>
            <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border border-dashed border-border" />{copy.legend.coming}</span>
          </div>
        </>
      ) : (
        <ErrorState body="We couldn't load the championship calendar. Try again in a moment." testId="clutch-card-calendar-error" title="Calendar unavailable" />
      )}
    </Section>
  );
}

function Why() {
  const copy = CLUTCH_CARD_PAGE.why;
  return (
    <Section eyebrow={copy.eyebrow} testId="clutch-card-why" title={copy.title}>
      <div className="grid gap-4 md:grid-cols-2">
        {copy.points.map((point) => (
          <Tile key={point.title} padding="md" radius="md">
            <Heading level={3} variant="card">{point.title}</Heading>
            <p className="mt-1 text-sm text-muted-foreground">{point.body}</p>
          </Tile>
        ))}
      </div>
    </Section>
  );
}

function HowItPlays() {
  const copy = CLUTCH_CARD_PAGE.howItPlays;
  return (
    <Section eyebrow={copy.eyebrow} id="how-it-plays" intro={copy.intro} testId="clutch-card-how-it-plays" title={copy.title}>
      <ol className="grid gap-4 md:grid-cols-3">
        {copy.steps.map((step, index) => (
          <li className="list-none" key={step.title}>
            <Tile className="h-full" padding="md" radius="md">
              <p className="font-display text-2xl font-bold text-muted-foreground">{index + 1}</p>
              <Heading level={3} variant="card">{step.title}</Heading>
              <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
            </Tile>
          </li>
        ))}
      </ol>
      <div className="grid gap-4 md:grid-cols-3">
        {copy.modes.map((mode) => (
          <div className="rounded-xl border border-border p-4" key={mode.title}>
            <Heading level={3} variant="card">{mode.title}</Heading>
            <p className="mt-1 text-sm text-muted-foreground">{mode.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Faq() {
  const copy = CLUTCH_CARD_PAGE.faq;
  return (
    <Section eyebrow={copy.eyebrow} id="questions" testId="clutch-card-faq" title={copy.title}>
      <div className="divide-y divide-border rounded-2xl border border-border">
        {copy.items.map((item) => (
          <details className="p-4" key={item.question}>
            <summary className="cursor-pointer font-semibold text-foreground">{item.question}</summary>
            <p className="mt-2 text-sm text-muted-foreground">{item.answer}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

/** The page's own menu, in section order. */
function SectionMenu() {
  return (
    <nav aria-label={STAT_POOL_CONTEST_TYPE} className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold" data-testid="clutch-card-menu">
      {CLUTCH_CARD_SECTIONS.map((section) => (
        <a className="text-muted-foreground hover:text-foreground" href={`#${section.id}`} key={section.id}>{section.label}</a>
      ))}
    </nav>
  );
}

/**
 * The Clutch Card's own landing page (#1066), open to every visitor at `/play/clutch-card`: what
 * the contest type is, each sport's stat line, and the title rounds it is played on. A round is
 * available while its stat pool sport league is, and links to the event page that offers it.
 */
export function ClutchCardPage() {
  const logger = useMemo(() => getLogger().child({ feature: 'clutch-card-page' }), []);
  const sportLeaguesQuery = useSportLeaguesQuery();
  const eventPagesQuery = useEventPagesQuery();

  useEffect(() => {
    if (sportLeaguesQuery.isError) {
      logger.warn({ action: 'clutchCardPage.sportLeagues.failed', err: sportLeaguesQuery.error }, 'Sport leagues failed to load');
    }
    if (eventPagesQuery.isError) {
      logger.warn({ action: 'clutchCardPage.eventPages.failed', err: eventPagesQuery.error }, 'Event pages failed to load');
    }
  }, [eventPagesQuery.error, eventPagesQuery.isError, logger, sportLeaguesQuery.error, sportLeaguesQuery.isError]);

  const statPoolLeagues = useMemo(() => statPoolLeagueByRound(sportLeaguesQuery.data ?? []), [sportLeaguesQuery.data]);
  const pages = useMemo(() => eventPagesQuery.data ?? [], [eventPagesQuery.data]);
  const startRequest = useMemo(() => startRequestFor(statPoolLeagues, pages), [pages, statPoolLeagues]);
  const rounds = useMemo((): ReadonlyMap<string, CalendarRound> | null => {
    if (sportLeaguesQuery.isError || eventPagesQuery.isError) {
      return null;
    }
    return new Map(CLUTCH_CARD_PAGE.calendar.months.flatMap((month) => month.rounds).map((round) => {
      const league = statPoolLeagues.get(roundKey(round.sport, round.sportLeague));
      return [roundKey(round.sport, round.sportLeague), { round, isAvailable: league !== undefined, eventPage: eventPageFor(league, pages) }];
    }));
  }, [eventPagesQuery.isError, pages, sportLeaguesQuery.isError, statPoolLeagues]);

  if (sportLeaguesQuery.isLoading || eventPagesQuery.isLoading) {
    return <LoadingState body={`Loading the ${STAT_POOL_CONTEST_TYPE}...`} />;
  }

  return (
    <section className="space-y-12" data-testid="clutch-card-page">
      <div className="space-y-4">
        <SectionMenu />
        <Hero startRequest={startRequest} />
      </div>
      <CardTypes />
      <Calendar rounds={rounds} />
      <Why />
      <HowItPlays />
      <Faq />
      <Tile className="flex flex-col items-start gap-4" data-testid="clutch-card-closing" padding="lg" radius="lg">
        <Heading level={2} variant="display">{CLUTCH_CARD_PAGE.closing.title}</Heading>
        {startRequest ? (
          <StartButton request={startRequest} testId="clutch-card-closing-start" />
        ) : (
          <LinkButton data-testid="clutch-card-closing-how-to-play" to="/how-to-play" variant="secondary">{EVENT_PAGE_ACTIONS.seeEveryWayToPlay}</LinkButton>
        )}
      </Tile>
      <p className="text-xs text-muted-foreground" data-testid="clutch-card-disclaimer">{CLUTCH_CARD_PAGE.footer}</p>
    </section>
  );
}
