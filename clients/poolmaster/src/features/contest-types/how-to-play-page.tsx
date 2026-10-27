import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { SelectionType, formatSelectionTypeName, getSportDefinition, type Sport } from '@poolmaster/shared/domain';
import type { ContestConfigTemplateDto, LeagueDto } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { useActiveContestTemplatesQuery } from '@/features/contests/use-active-contest-templates-query';
import { Button, ErrorState, LinkButton, LoadingState, PageHeader, SectionHeader, Tile, cn } from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { buildPublicContestCatalog, type ContestTypeTile, type PublicCatalogLeague, type PublicCatalogSport } from './contest-catalog';
import { FORMAT_GUIDES } from './format-guides';
import { ClutchCardIllustration, FormatIllustration, SportIllustration, StepIllustration, type StepPicture } from './illustrations';
import { SPORT_BLURBS } from './sport-blurbs';
import { STAT_POOL_CONTEST_TYPE, STAT_POOL_GUIDE, statPoolScoringLine } from '@/features/contests/scoring-family-ui/stat-pool-copy';
import { buildLeagueAdminContestCreateFromTemplatePath } from '@/features/leagues/league-routing';
import { useLeaguesQuery } from '@/features/leagues/use-leagues-query';
import { useSportLeaguesQuery } from './use-sport-leagues-query';
import { ComingUpRow } from '@/features/event-pages/coming-up-row';
import { CLUTCH_CARD_PAGE_PATH } from '@/features/event-pages/event-page-paths';

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

/** A sport as the page's link names it: `?sport=horse-racing`. */
function sportSlug(sport: Sport) {
  return sport.toLowerCase().replaceAll('_', '-');
}

function SportThumb({ sport, className }: { sport: Sport; className?: string }) {
  return <SportIllustration className={cn('shrink-0 rounded-full', className)} decorative sport={sport} />;
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
      <span className="text-muted-foreground">Create contest in</span>
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
  onChooseSport: (sport: Sport) => void;
  /** The active leagues the viewer runs, for Create contest. */
  createLeagues: readonly LeagueDto[];
}

/** One way to play: its diagram and summary, opening to its steps, where to play it and Create contest. */
function FormatCard({ selectionType, sports, chosen, isOpen, onToggle, onChooseSport, createLeagues }: FormatCardProps) {
  const guide = FORMAT_GUIDES[selectionType];
  const featured = chosen?.find((tile) => tile.selectionType === selectionType)?.featured;
  // With every sport shown, Create contest starts on the most popular sport's first league to offer it: the NFL's.
  const createTemplate = featured ?? sports[0]?.leagues
    .flatMap((league) => league.groups.filter((tile) => tile.selectionType === selectionType))
    .at(0)?.featured;
  return (
    <Tile
      className={cn('flex flex-col gap-3', isOpen ? 'col-span-full border-primary' : null)}
      data-testid={`how-to-play-format-${selectionType}`}
      padding="none"
      radius="md"
    >
      <Button
        aria-expanded={isOpen}
        className="h-auto flex-col items-stretch gap-2 rounded-2xl p-2 text-left font-normal"
        data-testid={`how-to-play-format-${selectionType}-toggle`}
        onClick={onToggle}
        size="auto"
        variant="ghost"
      >
        <FormatIllustration className={cn('aspect-[16/10] w-full rounded-xl', isOpen ? 'max-h-48' : null)} selectionType={selectionType} />
        <span className="px-1 font-display text-base font-bold text-foreground">{formatSelectionTypeName(selectionType)}</span>
        <span className="px-1 text-sm text-muted-foreground">{guide.summary}</span>
        {isOpen || chosen ? null : (
          <span aria-label={`On ${sports.map((sport) => sport.name).join(', ')}`} className="flex flex-wrap gap-1 px-1" role="img">
            {sports.map((sport) => <SportThumb className="h-5 w-5" key={sport.sport} sport={sport.sport} />)}
          </span>
        )}
      </Button>
      {isOpen ? (
        <div className="space-y-3 border-t border-border px-3 pb-3 pt-3 text-sm" data-testid={`how-to-play-format-${selectionType}-details`}>
          <ol className="list-decimal space-y-1 pl-5 text-foreground">
            {guide.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          {featured ? (
            <p className="text-muted-foreground">
              <span className="font-semibold text-foreground">{featured.name}.</span> {featured.description}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Play it on</span>
              {sports.map((sport) => (
                <Button
                  className="gap-1.5 rounded-full pl-1"
                  data-testid={`how-to-play-format-${selectionType}-sport-${sport.sport}`}
                  key={sport.sport}
                  onClick={() => onChooseSport(sport.sport)}
                  size="sm"
                  variant="secondary"
                >
                  <SportThumb className="h-6 w-6" sport={sport.sport} />
                  {sport.name}
                </Button>
              ))}
            </div>
          )}
          <CreateContestAction leagues={createLeagues} template={createTemplate} testId={`how-to-play-format-${selectionType}`} />
        </div>
      ) : null}
    </Tile>
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
    <Tile
      className={cn('flex flex-col gap-3', isOpen ? 'col-span-full border-primary' : null)}
      data-testid="how-to-play-clutch-card"
      padding="none"
      radius="md"
    >
      <Button
        aria-expanded={isOpen}
        className="h-auto flex-col items-stretch gap-2 rounded-2xl p-2 text-left font-normal"
        data-testid="how-to-play-clutch-card-toggle"
        onClick={onToggle}
        size="auto"
        variant="ghost"
      >
        {/* The card fills its whole picture, so an open tile keeps its shape rather than cropping it. */}
        <ClutchCardIllustration className={cn('aspect-[16/10] w-full rounded-xl', isOpen ? 'max-h-48 w-auto self-center' : null)} />
        <span className="px-1 font-display text-base font-bold text-foreground">{STAT_POOL_CONTEST_TYPE}</span>
        <span className="px-1 text-sm text-muted-foreground">{STAT_POOL_GUIDE.summary}</span>
      </Button>
      {isOpen ? (
        <div className="space-y-3 border-t border-border px-3 pb-3 pt-3 text-sm" data-testid="how-to-play-clutch-card-details">
          <ol className="list-decimal space-y-1 pl-5 text-foreground">
            {STAT_POOL_GUIDE.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <ul aria-label="Stat lines" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {statLines.map(({ sport, name }) => (
              <li className="flex items-center gap-2 rounded-lg border border-border bg-background p-2" data-testid={`how-to-play-clutch-card-stat-${sport}`} key={sport}>
                <SportThumb className="h-7 w-7" sport={sport} />
                <span className="min-w-0">
                  <span className="block font-semibold text-foreground">{name}</span>
                  <span className="block text-xs text-muted-foreground">{getSportDefinition(sport).name}</span>
                </span>
              </li>
            ))}
          </ul>
          <LinkButton data-testid="how-to-play-clutch-card-more" size="sm" to={CLUTCH_CARD_PAGE_PATH} variant="secondary">
            {`More about the ${STAT_POOL_CONTEST_TYPE}`}
          </LinkButton>
          <CreateContestAction leagues={createLeagues} template={statPoolLeagues[0]?.league.groups[0]?.featured} testId="how-to-play-clutch-card" />
        </div>
      ) : null}
    </Tile>
  );
}

interface SportLeagueChipsProps {
  catalog: PublicCatalogSport[];
  chosenSport: PublicCatalogSport | null;
  chosenLeague: PublicCatalogLeague | null;
  onChoose: (sport: Sport | null, league?: PublicCatalogLeague) => void;
}

/**
 * The sport leagues people know, the NFL and the PGA TOUR, as chips in rows by sport, the most
 * popular sport first. Each row opens with its sport in a fixed left column, which chooses every
 * league of it, and its leagues wrap to the right of it, so a sport never lands mid-row.
 */
function SportLeagueChips({ catalog, chosenSport, chosenLeague, onChoose }: SportLeagueChipsProps) {
  return (
    <div aria-label="Sport league" className="space-y-3" role="group">
      <Button
        aria-pressed={chosenSport === null}
        className="rounded-full"
        data-testid="how-to-play-sport-all"
        onClick={() => onChoose(null)}
        size="sm"
        variant={chosenSport === null ? 'primary' : 'secondary'}
      >
        All sports
      </Button>
      <div className="divide-y divide-border">
        {catalog.map((sport) => {
          const isSportChosen = chosenSport?.sport === sport.sport;
          return (
            <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-3 py-2 sm:grid-cols-[11rem_minmax(0,1fr)]" data-testid={`how-to-play-sport-group-${sport.sport}`} key={sport.sport}>
              <Button
                aria-pressed={isSportChosen && chosenLeague === null}
                className={cn('h-auto flex-col items-start justify-start gap-1 whitespace-normal rounded-lg p-1 text-left text-xs font-semibold uppercase sm:flex-row sm:items-center sm:gap-1.5 sm:rounded-full sm:pr-2', isSportChosen && chosenLeague === null ? 'text-foreground underline decoration-primary decoration-2 underline-offset-4' : 'text-muted-foreground')}
                data-testid={`how-to-play-sport-${sport.sport}`}
                onClick={() => onChoose(sport.sport)}
                size="auto"
                variant="ghost"
              >
                <SportThumb className="h-7 w-7" sport={sport.sport} />
                {sport.name}
              </Button>
              <div className="flex flex-wrap gap-2" data-testid={`how-to-play-sport-leagues-${sport.sport}`}>
                {sport.leagues.map((league) => (
                  <Button
                    aria-pressed={chosenLeague?.sportLeagueId === league.sportLeagueId}
                    className="rounded-full"
                    data-testid={`how-to-play-league-${sport.sport}-${league.slug}`}
                    key={league.sportLeagueId}
                    onClick={() => onChoose(sport.sport, league)}
                    size="sm"
                    variant={chosenLeague?.sportLeagueId === league.sportLeagueId ? 'primary' : 'secondary'}
                  >
                    {league.name}
                  </Button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * How to Play (#803, #878): open to every visitor. What a pool is, then the ways to play, each
 * offered by some sport's contest templates. A sport league chip, grouped by sport, narrows them
 * to what that league offers, and a sport to what any of its leagues does; either shows the
 * sport's picture and line, and the choice is kept in the link.
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
  const [searchParams, setSearchParams] = useSearchParams();
  const chosenSport = catalog.find((sport) => sportSlug(sport.sport) === searchParams.get('sport')) ?? null;
  const chosenLeague = chosenSport?.leagues.find((league) => league.slug === searchParams.get('league')) ?? null;
  const chosen = chosenLeague?.groups ?? chosenSport?.groups ?? null;
  const [openFormat, setOpenFormat] = useState<WayToPlay | null>(null);
  const toggle = (wayToPlay: WayToPlay) => setOpenFormat((open) => (open === wayToPlay ? null : wayToPlay));

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

  const choose = (sport: Sport | null, league?: PublicCatalogLeague) => {
    setOpenFormat(null);
    setSearchParams(sport ? { sport: sportSlug(sport), ...(league ? { league: league.slug } : {}) } : {}, { replace: true });
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
        description="Office pools for the events you already follow: pick your players, teams or horses, and see where you stand as it plays out."
        title="How to Play"
      />

      <ol className="-mx-1 grid auto-cols-[78%] grid-flow-col gap-3 overflow-x-auto px-1 pb-1 sm:auto-cols-[45%] md:grid-flow-row md:grid-cols-3 md:overflow-visible" data-testid="how-to-play-steps">
        {HOW_IT_WORKS.map((step, index) => (
          <li className="list-none" key={step.title}>
            <Tile className="h-full" padding="none" radius="md">
              <StepIllustration className="aspect-[16/10] w-full rounded-t-2xl" step={step.picture} />
              <div className="p-3">
                <h3 className="font-semibold text-foreground"><span className="mr-1 font-display font-bold text-primary">{index + 1}</span>{step.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
              </div>
            </Tile>
          </li>
        ))}
      </ol>

      <ComingUpRow key={chosenSport?.sport ?? 'all'} sport={chosenSport?.sport} testId="how-to-play-coming-up" />

      {templatesQuery.isLoading || sportLeaguesQuery.isLoading ? (
        <LoadingState body="Loading the ways to play..." />
      ) : isError ? (
        <ErrorState body="We couldn't load the contest types. Try again in a moment." title="Contest types unavailable" />
      ) : (
        <section className="space-y-4" data-testid="how-to-play-formats">
          <SectionHeader
            description={chosenLeague
              ? `Every way to play ${chosenLeague.name}. Tap one to see how it works.`
              : chosenSport ? `Every way to play ${chosenSport.name.toLowerCase()}. Tap one to see how it works.` : 'Tap one to see how it works, or pick a league.'}
            title="Ways to play"
          />
          <SportLeagueChips catalog={catalog} chosenLeague={chosenLeague} chosenSport={chosenSport} onChoose={choose} />

          {chosenSport ? (
            <Tile className="overflow-hidden md:flex" data-testid="how-to-play-sport-banner" padding="none" radius="md">
              <SportIllustration className="aspect-[16/10] w-full md:w-80" sport={chosenSport.sport} />
              <div className="p-4">
                <h3 className="font-display text-xl font-bold text-foreground">{chosenName}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{SPORT_BLURBS[chosenSport.sport]}</p>
              </div>
            </Tile>
          ) : null}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {formats.map((selectionType) => (
              <FormatCard
                chosen={chosen}
                createLeagues={createLeagues}
                isOpen={openFormat === selectionType}
                key={selectionType}
                onChooseSport={choose}
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
        </section>
      )}

      {auth.isAuthenticated ? null : (
        <Tile className="flex flex-wrap items-center justify-between gap-4" padding="md" radius="md">
          <div>
            <h3 className="font-semibold text-foreground">Ready to run your pool?</h3>
            <p className="text-sm text-muted-foreground">Create an account, start a league, and set up your first contest.</p>
          </div>
          {callToAction}
        </Tile>
      )}

    </section>
  );
}
