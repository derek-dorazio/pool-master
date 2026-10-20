import { useEffect, useMemo } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { useActiveContestTemplatesQuery } from '@/features/contests/use-active-contest-templates-query';
import { ErrorState, LinkButton, LoadingState, PageHeader, SectionHeader, Tile } from '@/features/shared/ui';
import { getLogger } from '@/lib/logger';
import { buildPublicContestCatalog } from './contest-catalog';
import { ContestTypeTileCard } from './contest-type-tile';
import { SPORT_BLURBS } from './sport-blurbs';

/** How a pool runs, in three steps. */
const HOW_IT_WORKS = [
  { title: 'Start a league', body: 'A commissioner sets up a league for the office, the family or the group chat, and invites everyone with one link.' },
  { title: 'Run contests on real events', body: 'Pick a contest type for a tournament, a race or a week of games. Members make their picks before it starts.' },
  { title: 'Follow it live', body: 'The leaderboard updates as the event plays out, and the standings settle the moment it ends.' },
];

/**
 * How to Play (#803): open to every visitor. What a pool is, then every sport and the contest
 * types it offers, read from the contest templates, with a way into registration.
 */
export function HowToPlayPage() {
  const logger = useMemo(() => getLogger().child({ feature: 'how-to-play-page' }), []);
  const auth = useAuth();
  const templatesQuery = useActiveContestTemplatesQuery();
  const catalog = useMemo(() => buildPublicContestCatalog(templatesQuery.data ?? []), [templatesQuery.data]);

  useEffect(() => {
    if (templatesQuery.isError) {
      logger.warn({ action: 'howToPlay.templates.failed', err: templatesQuery.error }, 'How to Play failed to load contest types');
    }
  }, [logger, templatesQuery.error, templatesQuery.isError]);

  const callToAction = auth.isAuthenticated ? (
    <LinkButton data-testid="how-to-play-leagues" to="/welcome">Go to your leagues</LinkButton>
  ) : (
    <LinkButton data-testid="how-to-play-register" state={{ authMode: 'register' }} to="/">Create your account</LinkButton>
  );

  return (
    <section className="space-y-10" data-testid="how-to-play-page">
      <PageHeader
        actions={callToAction}
        description="Office pools for the events you already follow: pick your players, teams or horses, and see where you stand as it plays out."
        title="How to Play"
      />

      <div className="grid gap-4 md:grid-cols-3">
        {HOW_IT_WORKS.map((step, index) => (
          <Tile key={step.title} padding="sm" radius="md">
            <p className="font-display text-sm font-bold text-primary">{index + 1}</p>
            <h3 className="mt-1 font-semibold text-foreground">{step.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
          </Tile>
        ))}
      </div>

      {templatesQuery.isLoading ? (
        <LoadingState body="Loading contest types..." />
      ) : templatesQuery.isError ? (
        <ErrorState body="We couldn't load the contest types. Try again in a moment." title="Contest types unavailable" />
      ) : (
        <div className="space-y-10">
          {catalog.map((sport) => (
            <section className="space-y-4" data-testid={`how-to-play-sport-${sport.sport}`} key={sport.sport}>
              <SectionHeader description={SPORT_BLURBS[sport.sport]} title={sport.name} />
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {sport.groups.map((tile) => <ContestTypeTileCard key={tile.key} tile={tile} />)}
              </div>
            </section>
          ))}
        </div>
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
