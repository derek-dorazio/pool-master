import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SelectionType, formatSelectionTypeName, type Sport } from '@poolmaster/shared/domain';
import { useAuth } from '@/features/auth/auth-context';
import { useActiveContestTemplatesQuery } from '@/features/contests/use-active-contest-templates-query';
import { Button, ErrorState, LinkButton, LoadingState, PageHeader, SectionHeader, Tile, cn } from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { buildPublicContestCatalog, type ContestCatalogSport, type ContestTypeTile } from './contest-catalog';
import { FORMAT_GUIDES } from './format-guides';
import { FormatIllustration, SportIllustration, StepIllustration, type StepPicture } from './illustrations';
import { SPORT_BLURBS } from './sport-blurbs';

/** How a pool runs, in three steps, each with its picture. */
const HOW_IT_WORKS: readonly { picture: StepPicture; title: string; body: string }[] = [
  { picture: 'league', title: 'Start a league', body: 'A commissioner sets up a league for the office, the family or the group chat, and invites everyone with one link.' },
  { picture: 'contest', title: 'Run contests on real events', body: 'Pick a contest type for a tournament, a race or a week of games. Members make their picks before it starts.' },
  { picture: 'live', title: 'Follow it live', body: 'The leaderboard updates as the event plays out, and the standings settle the moment it ends.' },
];

/** The ways to play in the order the page lists them. */
const FORMAT_ORDER = Object.values(SelectionType);

type CatalogSport = ContestCatalogSport<ContestTypeTile>;

/** A sport as the page's link names it: `?sport=horse-racing`. */
function sportSlug(sport: Sport) {
  return sport.toLowerCase().replaceAll('_', '-');
}

function SportThumb({ sport, className }: { sport: Sport; className?: string }) {
  return <SportIllustration className={cn('shrink-0 rounded-full', className)} decorative sport={sport} />;
}

interface FormatCardProps {
  selectionType: SelectionType;
  /** The sports that offer it; with a sport chosen, only that one. */
  sports: CatalogSport[];
  chosen: CatalogSport | null;
  isOpen: boolean;
  onToggle: () => void;
  onChooseSport: (sport: Sport) => void;
}

/** One way to play: its diagram and summary, opening to its steps and where to play it. */
function FormatCard({ selectionType, sports, chosen, isOpen, onToggle, onChooseSport }: FormatCardProps) {
  const guide = FORMAT_GUIDES[selectionType];
  const featured = chosen?.groups.find((tile) => tile.selectionType === selectionType)?.featured;
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
        </div>
      ) : null}
    </Tile>
  );
}

/**
 * How to Play (#803, #878): open to every visitor. What a pool is, then the ways to play, each
 * offered by some sport's contest templates. A sport chip narrows them to one sport and shows
 * its picture and line, and the chosen sport is kept in the link.
 */
export function HowToPlayPage() {
  const logger = useMemo(() => getLogger().child({ feature: 'how-to-play-page' }), []);
  const auth = useAuth();
  const templatesQuery = useActiveContestTemplatesQuery();
  const catalog = useMemo(() => buildPublicContestCatalog(templatesQuery.data ?? []), [templatesQuery.data]);
  const [searchParams, setSearchParams] = useSearchParams();
  const chosen = catalog.find((sport) => sportSlug(sport.sport) === searchParams.get('sport')) ?? null;
  const [openFormat, setOpenFormat] = useState<SelectionType | null>(null);

  useEffect(() => {
    if (templatesQuery.isError) {
      logger.warn({ action: 'howToPlay.templates.failed', err: templatesQuery.error }, 'How to Play failed to load contest types');
    }
  }, [logger, templatesQuery.error, templatesQuery.isError]);

  const chooseSport = (sport: Sport | null) => {
    setOpenFormat(null);
    setSearchParams(sport ? { sport: sportSlug(sport) } : {}, { replace: true });
  };

  const sportsOffering = (selectionType: SelectionType) => catalog.filter((sport) => sport.groups.some((tile) => tile.selectionType === selectionType));
  const formats = FORMAT_ORDER.filter((selectionType) => chosen
    ? chosen.groups.some((tile) => tile.selectionType === selectionType)
    : sportsOffering(selectionType).length > 0);

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

      {templatesQuery.isLoading ? (
        <LoadingState body="Loading the ways to play..." />
      ) : templatesQuery.isError ? (
        <ErrorState body="We couldn't load the contest types. Try again in a moment." title="Contest types unavailable" />
      ) : (
        <section className="space-y-4" data-testid="how-to-play-formats">
          <SectionHeader
            description={chosen ? `Every way to play ${chosen.name.toLowerCase()}. Tap one to see how it works.` : 'Tap one to see how it works, or pick a sport.'}
            title="Ways to play"
          />
          <div aria-label="Sport" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group">
            <Button
              aria-pressed={chosen === null}
              className="shrink-0 rounded-full"
              data-testid="how-to-play-sport-all"
              onClick={() => chooseSport(null)}
              size="sm"
              variant={chosen === null ? 'primary' : 'secondary'}
            >
              All sports
            </Button>
            {catalog.map((sport) => (
              <Button
                aria-pressed={chosen?.sport === sport.sport}
                className="shrink-0 gap-1.5 rounded-full pl-1"
                data-testid={`how-to-play-sport-${sport.sport}`}
                key={sport.sport}
                onClick={() => chooseSport(sport.sport)}
                size="sm"
                variant={chosen?.sport === sport.sport ? 'primary' : 'secondary'}
              >
                <SportThumb className="h-7 w-7" sport={sport.sport} />
                {sport.name}
              </Button>
            ))}
          </div>

          {chosen ? (
            <Tile className="overflow-hidden md:flex" data-testid="how-to-play-sport-banner" padding="none" radius="md">
              <SportIllustration className="aspect-[16/10] w-full md:w-80" sport={chosen.sport} />
              <div className="p-4">
                <h3 className="font-display text-xl font-bold text-foreground">{chosen.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{SPORT_BLURBS[chosen.sport]}</p>
              </div>
            </Tile>
          ) : null}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {formats.map((selectionType) => (
              <FormatCard
                chosen={chosen}
                isOpen={openFormat === selectionType}
                key={selectionType}
                onChooseSport={chooseSport}
                onToggle={() => setOpenFormat((open) => (open === selectionType ? null : selectionType))}
                selectionType={selectionType}
                sports={chosen ? [chosen] : sportsOffering(selectionType)}
              />
            ))}
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
