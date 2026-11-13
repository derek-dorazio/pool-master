import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { SelectionType, formatSelectionTypeName, getSportDefinition, type Sport } from '@poolmaster/shared/domain';
import type { LeagueDto } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { useActiveContestTemplatesQuery } from '@/features/contests/use-active-contest-templates-query';
import {
  cn,
  ExpandableTile,
  formatCount,
  LinkButton,
  OneLineRow,
  PageHeader,
  QueryState,
  refetchFailed,
  SectionCard,
  SectionRow,
  SectionRows,
  Text,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { buildPublicContestCatalog, type ContestTypeTile, type PublicCatalogLeague, type PublicCatalogSport } from './contest-catalog';
import { CreateContestAction } from './create-contest-action';
import { EveryLeagueCard } from './every-league-card';
import { FORMAT_GUIDES } from './format-guides';
import { HowItWorksStrip } from './how-it-works';
import { ClutchCardIllustration, FormatIllustration, SportIllustration } from './illustrations';
import { HOW_TO_PLAY_CLOSING_TITLE } from './public-headlines';
import { SPORT_BLURBS } from './sport-blurbs';
import { SportChipRow } from './sport-chip-row';
import { groupRounds, sportLeagueChoiceObject, sportLeagueChoiceSearch, useSportLeagueChoice, type FilterableSport } from './sport-league-choice';
import { SportLeagueColumn } from './sport-league-column';
import { STAT_POOL_CONTEST_TYPE, STAT_POOL_GUIDE, statPoolScoringLine } from '@/features/contests/scoring-family-ui/stat-pool-copy';
import { useLeaguesQuery } from '@/features/leagues/use-leagues-query';
import { useSportLeaguesQuery } from './use-sport-leagues-query';
import { ComingUpRow } from '@/features/event-pages/coming-up-row';
import { LandingSection } from '@/features/event-pages/components/landing-section';
import { CLUTCH_CARD_PAGE_PATH, howToPlayFormatAnchor } from '@/features/event-pages/event-page-paths';

/** The ways to play in the order the page lists them. */
const FORMAT_ORDER = Object.values(SelectionType);

/** The Clutch Card's place among the ways to play, which are otherwise formats. */
const CLUTCH_CARD = 'CLUTCH_CARD';
type WayToPlay = SelectionType | typeof CLUTCH_CARD;

/** The ways to play's anchor, which a league picked further down the page scrolls back to. */
const FORMATS_ANCHOR = 'ways-to-play';

/** One sport icon's width and the gap after it, for capping a tile's icons at one line. */
const SPORT_ICON_PX = 24;

/** The way to play a `?format=` link names, or null when it names none. */
function wayToPlayFrom(format: string | null): SelectionType | null {
  return FORMAT_ORDER.find((selectionType) => selectionType === format) ?? null;
}

function SportThumb({ sport, className }: { sport: Sport; className?: string }) {
  return <SportIllustration className={cn('shrink-0 rounded-full', className)} decorative sport={sport} />;
}

/** The sports a tile is played on, as small icons on one line, "+N" for the rest. */
function SportIcons({ sports, testId }: { sports: readonly Sport[]; testId: string }) {
  return (
    <OneLineRow
      className="px-1"
      itemPx={SPORT_ICON_PX}
      items={sports.map((sport) => ({ key: sport, node: <SportThumb className="h-5 w-5" sport={sport} /> }))}
      label={`On ${sports.map((sport) => getSportDefinition(sport).name).join(', ')}`}
      testId={testId}
    />
  );
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

/** A sport as the page's switch offers it: its catalog, and its leagues with their rounds under them. */
type HowToPlaySport = FilterableSport & { catalog: PublicCatalogSport };

function toHowToPlaySport(catalog: PublicCatalogSport): HowToPlaySport {
  const grouped = groupRounds(catalog.leagues.map((league) => ({ ...league, id: league.sportLeagueId, parentId: league.parentSportLeagueId })));
  return {
    sport: catalog.sport,
    name: catalog.name,
    catalog,
    leagues: grouped.map(({ league, rounds }) => ({
      slug: league.slug,
      name: league.name,
      rounds: rounds.map((round) => ({ slug: round.slug, name: round.name })),
    })),
  };
}

/** The formats of several sport leagues, one tile each, each led by the first league to offer it. */
function mergeFormats(leagues: readonly PublicCatalogLeague[]): ContestTypeTile[] {
  return FORMAT_ORDER.flatMap((selectionType) => {
    const tile = leagues.flatMap((league) => league.groups).find((each) => each.selectionType === selectionType);
    return tile ? [tile] : [];
  });
}

/** The stat pool leagues among those shown, each with its sport's stat line, which is the composite's name. */
function statPoolLeaguesOf(leagues: readonly PublicCatalogLeague[]) {
  return leagues.flatMap((league) => {
    const name = league.definition.composite?.name;
    return name && statPoolScoringLine(league.definition) !== null ? [{ league, name }] : [];
  });
}

interface FormatCardProps {
  selectionType: SelectionType;
  /** The sports that offer it; with a sport chosen, only that one. */
  sports: PublicCatalogSport[];
  /** The formats of the chosen sport or sport leagues, or null with every sport shown. */
  chosen: ContestTypeTile[] | null;
  isOpen: boolean;
  onToggle: () => void;
  /** The active leagues the viewer runs, for Create contest. */
  createLeagues: readonly LeagueDto[];
}

/**
 * One way to play: its diagram, summary and sports, and a commissioner's "+ Create"; opening to
 * its steps, where to play it and Create contest.
 */
function FormatCard({ selectionType, sports, chosen, isOpen, onToggle, createLeagues }: FormatCardProps) {
  const guide = FORMAT_GUIDES[selectionType];
  const typeName = formatSelectionTypeName(selectionType);
  const testId = `how-to-play-format-${selectionType}`;
  const featured = chosen?.find((tile) => tile.selectionType === selectionType)?.featured;
  // With every sport shown, Create contest starts on the most popular sport's first league to offer it: the NFL's.
  const createTemplate = featured ?? sports[0]?.leagues
    .flatMap((league) => league.groups.filter((tile) => tile.selectionType === selectionType))
    .at(0)?.featured;
  return (
    <ExpandableTile
      actions={createLeagues.length && createTemplate ? <CreateContestAction layout="compact" leagues={createLeagues} template={createTemplate} testId={testId} typeName={typeName} /> : null}
      face={(
        <>
          <FormatIllustration className={cn('aspect-[16/10] w-full rounded-xl', isOpen ? 'max-h-48' : null)} selectionType={selectionType} />
          <Text className="px-1" size="base" tone="default" variant="display">{typeName}</Text>
          <Text className="px-1" size="xsToSm" variant="meta">{guide.summary}</Text>
          {isOpen || chosen ? null : <SportIcons sports={sports.map((sport) => sport.sport)} testId={`${testId}-sports-icons`} />}
        </>
      )}
      id={howToPlayFormatAnchor(selectionType)}
      isOpen={isOpen}
      onToggle={onToggle}
      testId={testId}
    >
      <StepList steps={guide.steps} />
      {featured ? (
        <Text as="p" size="inherit" tone="muted">
          <Text size="inherit" variant="strong" weight="semibold">{`${featured.name}.`}</Text> {featured.description}
        </Text>
      ) : (
        <SectionCard headingLevel={3} testId={`${testId}-sports`} title="Play it on">
          <SectionRows>
            {sports.map((sport) => (
              <SectionRow
                facts={leagueSummary(sport.leagues)}
                key={sport.sport}
                name={sport.name}
                testId={`${testId}-sport-${sport.sport}`}
                to={sportLeagueChoiceSearch(sport.sport)}
              />
            ))}
          </SectionRows>
        </SectionCard>
      )}
      <CreateContestAction leagues={createLeagues} template={createTemplate} testId={testId} typeName={typeName} />
    </ExpandableTile>
  );
}

/**
 * The Clutch Card (#936, #1104) as one of the ways to play: its picture and line, opening to how
 * it plays, its steps, each shown sport's stat line as a small tile, the Clutch Card page for the
 * rest, and Create contest on the first shown stat pool league's default. Nothing while no shown
 * league is a stat pool's.
 */
function ClutchCardTile({ leagues, showSports, isOpen, onToggle, createLeagues }: {
  leagues: readonly PublicCatalogLeague[];
  /** Whether the closed tile names its sports, as it does with every sport shown. */
  showSports: boolean;
  isOpen: boolean;
  onToggle: () => void;
  createLeagues: readonly LeagueDto[];
}) {
  const statPoolLeagues = statPoolLeaguesOf(leagues);
  if (statPoolLeagues.length === 0) {
    return null;
  }
  // One line a sport: its stat line is the same in every one of its stat pool leagues.
  const statLines = [...new Map(statPoolLeagues.map(({ league, name }) => [league.definition.sport, { sport: league.definition.sport, name }] as const)).values()];
  const template = statPoolLeagues[0].league.groups.at(0)?.featured;
  return (
    <ExpandableTile
      actions={createLeagues.length > 0 && template ? <CreateContestAction layout="compact" leagues={createLeagues} template={template} testId="how-to-play-clutch-card" typeName={STAT_POOL_CONTEST_TYPE} /> : null}
      face={(
        <>
          {/* The card fills its whole picture, so an open tile keeps its shape rather than cropping it. */}
          <ClutchCardIllustration className={cn('aspect-[16/10] w-full rounded-xl', isOpen ? 'max-h-48 w-auto self-center' : null)} />
          <Text className="px-1" size="base" tone="default" variant="display">{STAT_POOL_CONTEST_TYPE}</Text>
          <Text className="px-1" size="xsToSm" variant="meta">{STAT_POOL_GUIDE.summary}</Text>
          {isOpen || !showSports ? null : <SportIcons sports={statLines.map(({ sport }) => sport)} testId="how-to-play-clutch-card-sports-icons" />}
        </>
      )}
      isOpen={isOpen}
      onToggle={onToggle}
      testId="how-to-play-clutch-card"
    >
      <Text as="p" size="inherit" tone="default">{STAT_POOL_GUIDE.detail}</Text>
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
      <CreateContestAction leagues={createLeagues} template={template} testId="how-to-play-clutch-card" typeName={STAT_POOL_CONTEST_TYPE} />
    </ExpandableTile>
  );
}

/**
 * How to Play (#803, #878, #1701): open to every visitor. The ways to play first, each offered by
 * some sport's contest templates, beside every sport and league on a computer (a sport chip row
 * on a phone); choosing a sport narrows them to what any of its leagues offers, a league to it and
 * its playoff rounds, and a round to that round, and the choice is kept in the link. Then how a
 * pool runs as one slim strip, what's coming up and, on a phone, every league as chips.
 */
export function HowToPlayPage() {
  const logger = useMemo(() => getLogger().child({ feature: 'how-to-play-page' }), []);
  const { locale } = useDisplayPreferences();
  const auth = useAuth();
  const templatesQuery = useActiveContestTemplatesQuery();
  const sportLeaguesQuery = useSportLeaguesQuery();
  const catalog = useMemo(
    () => buildPublicContestCatalog(templatesQuery.data ?? [], sportLeaguesQuery.data ?? []),
    [sportLeaguesQuery.data, templatesQuery.data],
  );
  const sports = useMemo(() => catalog.map(toHowToPlaySport), [catalog]);
  const [searchParams] = useSearchParams();
  const choice = useSportLeagueChoice(sports);
  const chosenSport = choice.sport?.catalog ?? null;
  const chosenLeagues = chosenSport && choice.leagueSlugs
    ? choice.leagueSlugs.flatMap((slug) => chosenSport.leagues.filter((league) => league.slug === slug))
    : null;
  const chosen = chosenLeagues ? mergeFormats(chosenLeagues) : chosenSport?.groups ?? null;
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

  // A new choice closes the open tile; one made below the tiles also scrolls back up to them.
  const closeOpen = () => setOpenFormat(null);
  const pickBelow = () => {
    setOpenFormat(null);
    document.getElementById(FORMATS_ANCHOR)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const sportsOffering = (selectionType: SelectionType) => catalog.filter((sport) => sport.groups.some((tile) => tile.selectionType === selectionType));
  const formats = FORMAT_ORDER.filter((selectionType) => chosen
    ? chosen.some((tile) => tile.selectionType === selectionType)
    : sportsOffering(selectionType).length > 0);
  const shownLeagues = chosenLeagues ?? (chosenSport ? [chosenSport] : catalog).flatMap((sport) => sport.leagues);
  const wayCount = formats.length + (statPoolLeaguesOf(shownLeagues).length > 0 ? 1 : 0);
  const playing = sportLeagueChoiceObject(choice);
  const heading = `${formatCount(wayCount, 'way', locale)} to play${playing ? ` ${playing}` : ''}`;

  const callToAction = auth.isAuthenticated ? (
    <LinkButton data-testid="how-to-play-leagues" to="/welcome">Go to your leagues</LinkButton>
  ) : (
    <LinkButton data-testid="how-to-play-register" state={{ authMode: 'register' }} to="/">Create your account</LinkButton>
  );


  return (
    <section className="space-y-6" data-testid="how-to-play-page">
      <PageHeader actions={callToAction} testId="how-to-play-header" title="How to Play" />

      {/* On a computer the steps lead, slim; on a phone they follow the ways to play. */}
      <HowItWorksStrip className="max-md:hidden" testId="how-to-play-steps" />

      <QueryState
        error="We couldn't load the contest types."
        loading="Loading the ways to play..."
        query={{ data: catalogLoaded ? catalog : undefined, isError, refetch: refetchFailed(templatesQuery, sportLeaguesQuery) }}
        size="tile"
        testId="how-to-play-catalog"
      >
        {() => (
          <div className="md:grid md:grid-cols-[200px_minmax(0,1fr)] md:items-start md:gap-6">
            <SportLeagueColumn choice={choice} className="sticky top-4 max-md:hidden" onPick={closeOpen} sports={sports} testId="how-to-play-leagues-column" />
            <div className="min-w-0 space-y-6">
              <SportChipRow choice={choice} className="md:hidden" onPick={closeOpen} sports={sports} testId="how-to-play-sport-chips" />
              <div className="scroll-mt-4" id={FORMATS_ANCHOR}>
                <SectionCard
                  bare
                  help={chosenSport ? SPORT_BLURBS[chosenSport.sport] : 'Tap one to see how it works, or pick a sport.'}
                  testId="how-to-play-formats"
                  title={heading}
                >
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
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
                      leagues={shownLeagues}
                      onToggle={() => toggle(CLUTCH_CARD)}
                      showSports={!chosenSport}
                    />
                  </div>
                </SectionCard>
              </div>
              <HowItWorksStrip className="md:hidden" testId="how-to-play-steps-phone" />
              <ComingUpRow key={chosenSport?.sport ?? 'all'} sport={chosenSport?.sport} testId="how-to-play-coming-up" />
              <EveryLeagueCard className="md:hidden" onPick={pickBelow} sports={sports} testId="how-to-play-every-league" />
            </div>
          </div>
        )}
      </QueryState>

      {auth.isAuthenticated ? null : (
        <LandingSection testId="how-to-play-cta" title={HOW_TO_PLAY_CLOSING_TITLE}>
          {callToAction}
        </LandingSection>
      )}

    </section>
  );
}
