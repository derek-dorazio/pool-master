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
import { FormatIllustration, SportIllustration } from './illustrations';
import { HOW_TO_PLAY_CLOSING_TITLE } from './public-headlines';
import { SPORT_BLURBS } from './sport-blurbs';
import { SportChipRow } from './sport-chip-row';
import { sportLeagueChoiceObject, sportLeagueChoiceSearch, useSportLeagueChoice, type FilterableSport } from './sport-league-choice';
import { SportLeagueColumn } from './sport-league-column';
import { useLeaguesQuery } from '@/features/leagues/use-leagues-query';
import { useSportLeaguesQuery } from './use-sport-leagues-query';
import { ComingUpRow } from '@/features/event-pages/coming-up-row';
import { LandingSection } from '@/features/event-pages/components/landing-section';
import { howToPlayFormatAnchor } from '@/features/event-pages/event-page-paths';

/** The ways to play in the order the page lists them. */
const FORMAT_ORDER = Object.values(SelectionType);

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

/** A sport as the page's switch offers it: its catalog, and its leagues. */
type HowToPlaySport = FilterableSport & { catalog: PublicCatalogSport };

function toHowToPlaySport(catalog: PublicCatalogSport): HowToPlaySport {
  return {
    sport: catalog.sport,
    name: catalog.name,
    catalog,
    count: wayCountOf(catalog.groups),
    leagues: catalog.leagues.map((league) => ({ slug: league.slug, name: league.name })),
  };
}

/**
 * How many ways to play the page shows: the formats among `tiles`. The heading's number, and the
 * column's beside each sport (#1716).
 */
function wayCountOf(tiles: readonly ContestTypeTile[]) {
  return FORMAT_ORDER.filter((selectionType) => tiles.some((tile) => tile.selectionType === selectionType)).length;
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
 * How to Play (#803, #878, #1701): open to every visitor. The ways to play first, each offered by
 * some sport's contest templates, beside every sport and league on a computer (a sport chip row
 * on a phone); choosing a sport narrows them to what any of its leagues offers, and a league to
 * what it offers, and the choice is kept in the link. Then how a
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
  const chosenLeague = chosenSport && choice.league
    ? chosenSport.leagues.find((league) => league.slug === choice.league?.slug) ?? null
    : null;
  const chosen = chosenLeague ? chosenLeague.groups : chosenSport?.groups ?? null;
  // A contest page's "How to play this contest" names its format (#1392): that tile opens, in view.
  const [requestedFormat] = useState(() => wayToPlayFrom(searchParams.get('format')));
  const [openFormat, setOpenFormat] = useState<SelectionType | null>(requestedFormat);
  const toggle = (wayToPlay: SelectionType) => setOpenFormat((open) => (open === wayToPlay ? null : wayToPlay));
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
  const wayCount = wayCountOf(chosen ?? catalog.flatMap((sport) => sport.groups));
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
