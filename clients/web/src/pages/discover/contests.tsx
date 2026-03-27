import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SearchBar } from '@/features/discovery/search-bar';
import { ContestDiscoveryCard } from '@/features/discovery/discovery-cards';
import { useBrowseContests } from '@/features/discovery/hooks/use-discovery';
import { Badge } from '@/components/ui/badge';

const SPORTS = ['ALL', 'GOLF', 'NFL', 'NBA', 'F1', 'NCAA_BASKETBALL', 'SOCCER', 'TENNIS', 'HORSE_RACING'];
const SORT_OPTIONS = [
  { value: 'starting_soon', label: 'Starting Soon' },
  { value: 'popular', label: 'Most Popular' },
  { value: 'newest', label: 'Newest' },
];

export function Component() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sport = searchParams.get('sport') ?? 'ALL';
  const sort = searchParams.get('sort') ?? 'starting_soon';
  const [query, setQuery] = useState(searchParams.get('q') ?? '');

  const { data, isLoading } = useBrowseContests({ sport: sport !== 'ALL' ? sport : undefined, sort, q: query || undefined });

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value && value !== 'ALL') params.set(key, value);
    else params.delete(key);
    setSearchParams(params);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Browse Contests</h1>
        <p className="text-sm text-muted-foreground mt-1">Open contests accepting entries. Find your next competition.</p>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <SearchBar
          value={query}
          onChange={(v) => { setQuery(v); updateFilter('q', v); }}
          placeholder="Search contests..."
        />

        <div className="flex flex-wrap items-center gap-2">
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
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : data?.contests.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No open contests found matching your filters.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{data?.total} contests found</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data?.contests.map((contest) => (
              <ContestDiscoveryCard key={contest.id} contest={contest} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
