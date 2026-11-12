import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { SelectionType, formatSelectionTypeName, getSportDefinition, type Sport } from '@poolmaster/shared/domain';
import type { ContestConfigTemplateDto, LeagueDto } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { useActiveContestTemplatesQuery } from '@/features/contests/use-active-contest-templates-query';
import { cn, ExpandableTile, LinkButton, NumberedSteps, PageHeader, QueryState, refetchFailed, SectionCard, SectionRow, SectionRows, Text } from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { buildPublicContestCatalog, type ContestTypeTile, type PublicCatalogLeague, type PublicCatalogSport } from './contest-catalog';
import { FORMAT_GUIDES } from './format-guides';
import { ClutchCardIllustration, FormatIllustration, SportIllustration, StepIllustration, type StepPicture } from './illustrations';
import { SPORT_BLURBS } from './sport-blurbs';
import { sportSlug, useSportLeagueChoice } from './sport-league-choice';
import { SportLeagueFilter } from './sport-league-filter';
import { STAT_POOL_CONTEST_TYPE, STAT_POOL_GUIDE, statPoolScoringLine } from '@/features/contests/scoring-family-ui/stat-pool-copy';
import { buildLeagueAdminContestCreateFromTemplatePath } from '@/features/leagues/league-routing';
import { useLeaguesQuery } from '@/features/leagues/use-leagues-query';
import { useSportLeaguesQuery } from './use-sport-leagues-query';
import { ComingUpRow } from '@/features/event-pages/coming-up-row';
import { LandingSection } from '@/features/event-pages/components/landing-section';
import { CLUTCH_CARD_PAGE_PATH, howToPlayFormatAnchor } from '@/features/event-pages/event-page-paths';

/** How a pool runs, in three steps, each with its picture. */
const HOW_IT_WORKS: readonly { picture: StepPicture; title: string; body: string }[] = [
  { picture: 'league', title: 'Start a league', body: 'A commissioner sets up a league for the office, the family or the group chat, and invites everyone with one link.' },
  { picture: 'contest', title: 'Run contests on real events', body: 'Pick a contest type for a tournament, a race or a week of games. Members make their picks before it starts.' },
  { picture: 'live', title: 'Follow it live', body: 'The leaderboard updates as the event plays out, and the standings settle the moment it ends.' },
];

/** The ways to play in the order the page lists them. */
const FORMAT_ORDER = Object.values(SelectionType);

/** The Clutch Card's place among the ways to play, which are otherwise formats. */
const CLUTCH_CARD = 'CLUTCH_CARD';
type WayToPlay = SelectionType | typeof CLUTCH_CARD;

/** The way to play a `?format=` link names, or null when it names none. */
function wayToPlayFrom(format: string | null): SelectionType | null {
  return FORMAT_ORDER.find((selectionType) => selectionType === format) ?? null;
}

function SportThumb({ sport, className }: { sport: Sport; className?: string }) {
  return <SportIllustration className={cn('shrink-0 rounded-full', className)} decorative sport={sport} />;
}

/** A sport's leagues on one short line: the first three by name, then how many more. */
function leagueSummary(leagues: readonly PublicCatalogLeague[]) {
  const names = leagues.slice(0, 3).map((league) => league.name).join(' · ');
  return leagues.length > 3 ? `${names} + ${leagues.length - 3} more` : names;
}

/** A way to play's steps, numbered, in the words around them. */
function StepList({ steps }: { steps: readonly string[] }) {
  return (
    <Text asChild size="inherit" tone="default">
      <ol className="list-decimal space-y-1 pl-5">
        {steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
    </Text>
  );
}

/**
 * Create contest on a way to play's template (#1104), for a viewer who runs a league: one league
 * opens straight on it, several are each a button. Nothing for anyone else.
 */
function CreateContestAction({ leagues, template, testId }: { leagues: readonly LeagueDto[]; template: ContestConfigTemplateDto | undefined; testId: string }) {
  if (!template || leagues.length === 0) {
    return null;
  }
  if (leagues.length === 1) {
    return (
      <LinkButton data-testid={`${testId}-create`} size="sm" to={buildLeagueAdminContestCreateFromTemplatePath(leagues[0].leagueCode, template.id)}>
        Create contest
      </LinkButton>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`${testId}-create`}>
      <Text size="inherit" tone="muted">Create contest in</Text>
      {leagues.map((league) => (
        <LinkButton
          data-testid={`${testId}-create-${league.leagueCode}`}
          key={league.id}
          size="sm"
          to={buildLeagueAdminContestCreateFromTemplatePath(league.leagueCode, template.id)}
          variant="secondary"
        >
          {league.name}
        </LinkButton>
      ))}
    </div>
  );
}

interface FormatCardProps {
  selectionType: SelectionType;
  /** The sports that offer it; with a sport chosen, only that one. */
  sports: PublicCatalogSport[];
  /** The formats of the chosen sport or sport league, or null with every sport shown. */
  chosen: ContestTypeTile[] | null;
  isOpen: boolean;
  onToggle: () => void;
  /** The active leagues the viewer runs, for Create contest. */
  createLeagues: readonly LeagueDto[];
}

/** One way to play: its diagram and summary, opening to its steps, where to play it and Create contest. */
function FormatCard({ selectionType, sports, chosen, isOpen, onToggle, createLeagues }: FormatCardProps) {
  const guide = FORMAT_GUIDES[selectionType];
  const featured = chosen?.find((tile) => tile.selectionType === selectionType)?.featured;
  // With every sport shown, Create contest starts on the most popular sport's first league to offer it: the NFL's.
  const createTemplate = featured ?? sports[0]?.leagues
    .flatMap((league) => league.groups.filter((tile) => tile.selectionType === selectionType))
    .at(0)?.featured;
  return (
    <ExpandableTile
      face={(
        <>
          <FormatIllustration className={cn('aspect-[16/10] w-full rounded-xl', isOpen ? 'max-h-48' : null)} selectionType={selectionType} />
          <Text className="px-1" size="base" tone="default" variant="display">{formatSelectionTypeName(selectionType)}</Text>
          <Text className="px-1" variant="meta">{guide.summary}</Text>
          {isOpen || chosen ? null : (
            <span aria-label={`On ${sports.map((sport) => sport.name).join(', ')}`} className="flex flex-wrap gap-1 px-1" role="img">
              {sports.map((sport) => <SportThumb className="h-5 w-5" key={sport.sport} sport={sport.sport} />)}
            </span>
          )}
        </>
      )}
      id={howToPlayFormatAnchor(selectionType)}
      isOpen={isOpen}
      onToggle={onToggle}
      testId={`how-to-play-format-${selectionType}`}
    >
      <StepList steps={guide.steps} />
      {featured ? (
        <Text as="p" size="inherit" tone="muted">
          <Text size="inherit" variant="strong" weight="semibold">{`${featured.name}.`}</Text> {featured.description}
        </Text>
      ) : (
        <SectionCard headingLevel={3} testId={`how-to-play-format-${selectionType}-sports`} title="Play it on">
          <SectionRows>
            {sports.map((sport) => (
              <SectionRow
                facts={leagueSummary(sport.leagues)}
                key={sport.sport}
                name={sport.name}
                testId={`how-to-play-format-${selectionType}-sport-${sport.sport}`}
                to={`?sport=${sportSlug(sport.sport)}`}
              />
            ))}
          </SectionRows>
        </SectionCard>
      )}
      <CreateContestAction leagues={createLeagues} template={createTemplate} testId={`how-to-play-format-${selectionType}`} />
    </ExpandableTile>
  );
}

/**
 * The Clutch Card (#936, #1104) as one of the ways to play: its picture and line, opening to its
 * steps, each shown sport's stat line as a small tile, the Clutch Card page for the rest, and
 * Create contest on the first shown stat pool league's default. Nothing while no shown league
 * is a stat pool's.
 */
function ClutchCardTile({ leagues, isOpen, onToggle, createLeagues }: {
  leagues: readonly PublicCatalogLeague[];
  isOpen: boolean;
  onToggle: () => void;
  createLeagues: readonly LeagueDto[];
}) {
  // A stat pool league scores its sport's composite, whose name is its stat line.
  const statPoolLeagues = leagues.flatMap((league) => {
    const name = league.definition.composite?.name;
    return name && statPoolScoringLine(league.definition) !== null ? [{ league, name }] : [];
  });
  if (statPoolLeagues.length === 0) {
    return null;
  }
  // One tile a sport: its stat line is the same in every one of its stat pool leagues.
  const statLines = [...new Map(statPoolLeagues.map(({ league, name }) => [league.definition.sport, { sport: league.definition.sport, name }] as const)).values()];
  return (
    <ExpandableTile
      face={(
        <>
          {/* The card fills its whole picture, so an open tile keeps its shape rather than cropping it. */}
          <ClutchCardIllustration className={cn('aspect-[16/10] w-full rounded-xl', isOpen ? 'max-h-48 w-auto self-center' : null)} />
          <Text className="px-1" size="base" tone="default" variant="display">{STAT_POOL_CONTEST_TYPE}</Text>
          <Text className="px-1" variant="meta">{STAT_POOL_GUIDE.summary}</Text>
        </>
      )}
      isOpen={isOpen}
      onToggle={onToggle}
      testId="how-to-play-clutch-card"
    >
      <StepList steps={STAT_POOL_GUIDE.steps} />
      <SectionCard headingLevel={3} testId="how-to-play-clutch-card-stats" title="Stat lines">
        <SectionRows>
          {statLines.map(({ sport, name }) => (
            <SectionRow facts={getSportDefinition(sport).name} key={sport} name={name} testId={`how-to-play-clutch-card-stat-${sport}`} />
          ))}
        </SectionRows>
      </SectionCard>
      <LinkButton data-testid="how-to-play-clutch-card-more" size="sm" to={CLUTCH_CARD_PAGE_PATH} variant="secondary">
        {`More about the ${STAT_POOL_CONTEST_TYPE}`}
      </LinkButton>
      <CreateContestAction leagues={createLeagues} template={statPoolLeagues[0]?.league.groups[0]?.featured} testId="how-to-play-clutch-card" />
    </ExpandableTile>
  );
}

/**
 * How to Play (#803, #878): open to every visitor. What a pool is, then the ways to play, each
 * offered by some sport's contest templates. The sport switch in the header narrows them to what
 * a sport league offers, or a sport to what any of its leagues does; either shows the sport's
 * picture and line, and the choice is kept in the link.
 */
export function HowToPlayPage() {
  const logger = useMemo(() => getLogger().child({ feature: 'how-to-play-page' }), []);
  const auth = useAuth();
  const templatesQuery = useActiveContestTemplatesQuery();
  const sportLeaguesQuery = useSportLeaguesQuery();
  const catalog = useMemo(
    () => buildPublicContestCatalog(templatesQuery.data ?? [], sportLeaguesQuery.data ?? []),
    [sportLeaguesQuery.data, templatesQuery.data],
  );
  const [searchParams] = useSearchParams();
  const choice = useSportLeagueChoice(catalog);
  const chosenSport = choice.sport;
  const chosenLeague = chosenSport?.leagues.find((league) => league.slug === choice.leagueSlug) ?? null;
  const chosen = chosenLeague?.groups ?? chosenSport?.groups ?? null;
  // A contest page's "How to play this contest" names its format (#1392): that tile opens, in view.
  const [requestedFormat] = useState(() => wayToPlayFrom(searchParams.get('format')));
  const [openFormat, setOpenFormat] = useState<WayToPlay | null>(requestedFormat);
  const toggle = (wayToPlay: WayToPlay) => setOpenFormat((open) => (open === wayToPlay ? null : wayToPlay));
  const catalogLoaded = templatesQuery.isSuccess && sportLeaguesQuery.isSuccess;
  const scrolledToRequested = useRef(false);
  useEffect(() => {
    if (catalogLoaded && requestedFormat && !scrolledToRequested.current) {
      scrolledToRequested.current = true;
      document.getElementById(howToPlayFormatAnchor(requestedFormat))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [catalogLoaded, requestedFormat]);

  // Create contest is for whoever runs an active league; only a signed-in viewer's are read.
  const { leagues, commissionerLeagueIds } = useLeaguesQuery({ enabled: auth.isAuthenticated });
  const createLeagues = useMemo(
    () => (auth.isAuthenticated ? (leagues ?? []).filter((league) => league.isActive && commissionerLeagueIds.has(league.id)) : []),
    [auth.isAuthenticated, commissionerLeagueIds, leagues],
  );

  const isError = templatesQuery.isError || sportLeaguesQuery.isError;
  useEffect(() => {
    if (isError) {
      logger.warn({ action: 'howToPlay.catalog.failed', err: templatesQuery.error ?? sportLeaguesQuery.error }, 'How to Play failed to load contest types');
    }
  }, [isError, logger, sportLeaguesQuery.error, templatesQuery.error]);

  const choose = (sport: Sport | null, league?: string) => {
    setOpenFormat(null);
    choice.choose(sport, league);
  };

  const sportsOffering = (selectionType: SelectionType) => catalog.filter((sport) => sport.groups.some((tile) => tile.selectionType === selectionType));
  const formats = FORMAT_ORDER.filter((selectionType) => chosen
    ? chosen.some((tile) => tile.selectionType === selectionType)
    : sportsOffering(selectionType).length > 0);
  const chosenName = chosenLeague?.name ?? chosenSport?.name;

  const callToAction = auth.isAuthenticated ? (
    <LinkButton data-testid="how-to-play-leagues" to="/welcome">Go to your leagues</LinkButton>
  ) : (
    <LinkButton data-testid="how-to-play-register" state={{ authMode: 'register' }} to="/">Create your account</LinkButton>
  );

  return (
    <section className="space-y-8" data-testid="how-to-play-page">
      <PageHeader
        actions={callToAction}
        tabsEnd={catalogLoaded ? (
          <SportLeagueFilter leagueSlug={chosenLeague?.slug ?? null} onChoose={choose} sport={chosenSport?.sport ?? null} sports={catalog} testId="how-to-play-sport-filter" />
        ) : null}
        testId="how-to-play-header"
        title="How to Play"
      />

      <NumberedSteps
        className="-mx-1 auto-cols-[78%] grid-flow-col gap-3 overflow-x-auto px-1 pb-1 sm:auto-cols-[45%] md:grid-flow-row md:overflow-visible"
        steps={HOW_IT_WORKS.map((step) => ({
          ...step,
          picture: <StepIllustration className="aspect-[16/10] w-full rounded-t-2xl" step={step.picture} />,
        }))}
        testId="how-to-play-steps"
      />

      <ComingUpRow key={chosenSport?.sport ?? 'all'} sport={chosenSport?.sport} testId="how-to-play-coming-up" />

      <QueryState
        error="We couldn't load the contest types."
        loading="Loading the ways to play..."
        query={{ data: catalogLoaded ? catalog : undefined, isError, refetch: refetchFailed(templatesQuery, sportLeaguesQuery) }}
        size="tile"
        testId="how-to-play-catalog"
      >
        {() => (
        <SectionCard
          bare
          help={chosenLeague
            ? `Every way to play ${chosenLeague.name}. Tap one to see how it works.`
            : chosenSport ? `Every way to play ${chosenSport.name.toLowerCase()}. Tap one to see how it works.` : 'Tap one to see how it works, or pick a sport.'}
          testId="how-to-play-formats"
          title="Ways to play"
        >
          {chosenSport ? (
            <SectionCard headingLevel={3} help={SPORT_BLURBS[chosenSport.sport]} testId="how-to-play-sport-banner" title={chosenName}>
              <SportIllustration className="aspect-[16/10] w-full md:mx-auto md:max-w-md" sport={chosenSport.sport} />
            </SectionCard>
          ) : null}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {formats.map((selectionType) => (
              <FormatCard
                chosen={chosen}
                createLeagues={createLeagues}
                isOpen={openFormat === selectionType}
                key={selectionType}
                onToggle={() => toggle(selectionType)}
                selectionType={selectionType}
                sports={chosenSport ? [chosenSport] : sportsOffering(selectionType)}
              />
            ))}
            <ClutchCardTile
              createLeagues={createLeagues}
              isOpen={openFormat === CLUTCH_CARD}
              leagues={chosenLeague ? [chosenLeague] : (chosenSport ? [chosenSport] : catalog).flatMap((sport) => sport.leagues)}
              onToggle={() => toggle(CLUTCH_CARD)}
            />
          </div>
        </SectionCard>
        )}
      </QueryState>

      {auth.isAuthenticated ? null : (
        <LandingSection intro="Create an account, start a league, and set up your first contest." testId="how-to-play-cta" title="Ready to run your pool?">
          {callToAction}
        </LandingSection>
      )}

    </section>
  );
}
