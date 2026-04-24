import { Link, useParams } from 'react-router-dom';
import {
  buildLeaguePath,
  buildLeagueTeamPath,
} from './league-routing';

type LeagueRouteScaffoldKey =
  | 'history'
  | 'contests'
  | 'manage-contests';

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
  history: {
    title: 'My Contest History',
    description:
      'This placeholder route reserves the canonical history destination while the dedicated history page is still being designed and built.',
    fallbackLabel: 'Open current My Team page',
    buildFallbackPath: buildLeagueTeamPath,
  },
  contests: {
    title: 'League Contests',
    description:
      'This route is the future canonical contest-list destination. Until the dedicated list page lands, use League Home for the live contest cards and commissioner actions.',
    fallbackLabel: 'Open current League Home',
    buildFallbackPath: buildLeaguePath,
  },
  'manage-contests': {
    title: 'Manage Contests',
    description:
      'This list route is staged now so commissioner navigation can converge here later. Until then, contest management continues through League Home and the existing per-contest manage routes.',
    fallbackLabel: 'Open current League Home',
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
          This is a truthful scaffold page. The canonical route now exists, but
          the dedicated page decomposition has not landed yet.
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
