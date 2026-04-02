import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sport } from '@poolmaster/shared/domain/enums';
import { SearchBar } from '@/features/discovery/search-bar';
import { LeagueDiscoveryCard } from '@/features/discovery/discovery-cards';
import { useBrowseLeagues, useJoinLeague } from '@/features/discovery/hooks/use-discovery';
import { Badge } from '@/components/ui/badge';

const SPORTS = ['ALL', Sport.GOLF, Sport.NFL, Sport.NBA, Sport.F1, Sport.NCAA_BASKETBALL, Sport.SOCCER, Sport.TENNIS, Sport.HORSE_RACING];
const SORT_OPTIONS = [
  { value: 'active', label: 'Most Active' },
  { value: 'newest', label: 'Newest' },
  { value: 'members', label: 'Most Members' },
  { value: 'alpha', label: 'A-Z' },
];

export function Component() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sport = searchParams.get('sport') ?? 'ALL';
  const sort = searchParams.get('sort') ?? 'active';
  const [query, setQuery] = useState(searchParams.get('q') ?? '');

  const { data, isLoading } = useBrowseLeagues({ sport: sport !== 'ALL' ? sport : undefined, sort, q: query || undefined });
  const joinLeague = useJoinLeague();

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value && value !== 'ALL') params.set(key, value);
    else params.delete(key);
    setSearchParams(params);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Browse Leagues</h1>
        <p className="text-sm text-muted-foreground mt-1">Find and join public leagues across all sports.</p>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <SearchBar
          value={query}
          onChange={(v) => { setQuery(v); updateFilter('q', v); }}
          placeholder="Search leagues by name..."
        />

        <div className="flex flex-wrap items-center gap-2">
          {/* Sport filter */}
          {SPORTS.map((s) => (
            <Badge
              key={s}
              variant={sport === s ? 'default' : 'outline'}
              className="cursor-pointer text-xs"
              onClick={() => updateFilter('sport', s)}
            >
              {s === 'ALL' ? 'All Sports' : s.replace('_', ' ')}
            </Badge>
          ))}

          {/* Sort */}
          <select
            value={sort}
            onChange={(e) => updateFilter('sort', e.target.value)}
            className="ml-auto h-8 rounded-md border bg-background px-2 text-xs"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : data?.leagues.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No leagues found matching your filters.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{data?.total} leagues found</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data?.leagues.map((league) => (
              <LeagueDiscoveryCard
                key={league.id}
                league={league}
                onJoin={() => joinLeague.mutate(league.id)}
                isJoining={joinLeague.isPending}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
