import { Link, useParams } from 'react-router-dom';
import {
  buildLeaguePath,
} from './league-routing';

type LeagueRouteScaffoldKey =
  | 'contests';

type LeagueRouteScaffoldDefinition = {
  title: string;
  description: string;
  fallbackLabel: string;
  buildFallbackPath: (leagueCode: string) => string;
};

const LEAGUE_ROUTE_SCAFFOLDS: Record<
  LeagueRouteScaffoldKey,
  LeagueRouteScaffoldDefinition
> = {
  contests: {
    title: 'League Contests',
    description:
      'Contest cards and commissioner contest actions are available from League Home.',
    fallbackLabel: 'Open League Home',
    buildFallbackPath: buildLeaguePath,
  },
};

type LeagueRouteScaffoldPageProps = {
  scaffoldKey: LeagueRouteScaffoldKey;
};

export function LeagueRouteScaffoldPage({
  scaffoldKey,
}: LeagueRouteScaffoldPageProps) {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const scaffold = LEAGUE_ROUTE_SCAFFOLDS[scaffoldKey];
  const fallbackPath = scaffold.buildFallbackPath(leagueCode);

  return (
    <section
      className="space-y-6"
      data-testid={`league-route-scaffold-page-${scaffoldKey}`}
    >
      <div className="rounded-[2rem] border border-border bg-card p-6">
        <Link
          className="text-sm font-medium text-primary transition hover:opacity-80"
          to={buildLeaguePath(leagueCode)}
        >
          Back to League Home
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
          {scaffold.title}
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          {scaffold.description}
        </p>
      </div>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          Use League Home to view contests, open contest boards, and manage contest setup.
        </p>
        <Link
          className="mt-5 inline-flex items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/15"
          data-testid={`league-route-scaffold-link-${scaffoldKey}`}
          to={fallbackPath}
        >
          {scaffold.fallbackLabel}
        </Link>
      </section>
    </section>
  );
}
