import type { ListLeaguesResponses } from '@/lib/api';
import {
  buildLeaguePath,
  getLeagueSelectorOptions,
  getLeagueInitials,
  setRecentLeagueCode,
} from '@/features/leagues/league-routing';

type LeagueSummary = ListLeaguesResponses[200]['leagues'][number];

type LeagueSelectorProps = {
  activeLeagueCode?: string | null;
  leagues: LeagueSummary[];
  onCreateLeague: () => void;
  onNavigate: (path: string) => void;
};

export function LeagueSelector({
  activeLeagueCode,
  leagues,
  onCreateLeague,
  onNavigate,
}: LeagueSelectorProps) {
  const activeLeague = leagues.find((league) => league.leagueCode === activeLeagueCode) ?? null;
  const selectorLeagues = getLeagueSelectorOptions(leagues);

  return (
    <details className="relative">
      <summary
        className="flex cursor-pointer list-none items-center gap-3 rounded-[1.5rem] border border-border bg-background px-4 py-3 text-left shadow-sm"
        data-testid="league-selector-toggle"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {activeLeague ? getLeagueInitials(activeLeague.name) : 'LG'}
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">League</div>
          <div className="truncate text-sm font-semibold text-foreground">
            {activeLeague?.name ?? 'Select league'}
          </div>
        </div>
      </summary>

      <div className="absolute right-0 z-20 mt-3 w-72 rounded-[1.5rem] border border-border bg-card p-3 shadow-xl">
        <div className="space-y-2">
          {selectorLeagues.map((league) => (
            <button
              className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                league.leagueCode === activeLeagueCode
                  ? league.isActive
                    ? 'border-primary/20 bg-primary/10'
                    : 'border-amber-200 bg-amber-50'
                  : league.isActive
                    ? 'border-transparent hover:bg-muted/50'
                    : 'border-amber-200/70 bg-amber-50/70 hover:bg-amber-100/70'
              }`}
              data-testid={`league-selector-option-${league.leagueCode}`}
              key={league.id}
              onClick={() => {
                setRecentLeagueCode(league.leagueCode);
                onNavigate(buildLeaguePath(league.leagueCode));
              }}
              type="button"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                {getLeagueInitials(league.name)}
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">{league.name}</div>
                <div className="truncate text-xs uppercase tracking-[0.22em] text-muted-foreground">
                  {league.isActive ? league.leagueCode : 'Not currently active'}
                </div>
              </div>
            </button>
          ))}

          <button
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition hover:bg-muted/50"
            data-testid="league-selector-create"
            onClick={onCreateLeague}
            type="button"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-border text-lg text-muted-foreground">
              +
            </div>
            <div className="font-medium text-foreground">Create league</div>
          </button>
        </div>
      </div>
    </details>
  );
}
