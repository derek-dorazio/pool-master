import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SearchBar } from '@/features/discovery/search-bar';
import { LeagueDiscoveryCard } from '@/features/discovery/discovery-cards';
import { ContestDiscoveryCard } from '@/features/discovery/discovery-cards';
import { useGlobalSearch, useJoinLeague } from '@/features/discovery/hooks/use-discovery';

export function Component() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(initialQuery);
  const [activeTab, setActiveTab] = useState('all');

  const { data, isLoading } = useGlobalSearch(query);
  const joinLeague = useJoinLeague();

  const leagueCount = data?.leagues.length ?? 0;
  const contestCount = data?.contests.length ?? 0;
  const totalCount = leagueCount + contestCount;

  function handleSearch(q: string) {
    setQuery(q);
    const params = new URLSearchParams(searchParams);
    if (q) params.set('q', q);
    else params.delete('q');
    setSearchParams(params, { replace: true });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Search Results</h1>
      </div>

      <SearchBar
        value={query}
        onChange={handleSearch}
        placeholder="Search leagues, contests, events..."
        autoFocus
      />

      {!query.trim() ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">Start typing to search across leagues and contests.</p>
        </div>
      ) : isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : totalCount === 0 ? (
        <div className="text-center py-12">
          <p className="text-lg font-medium">No results found</p>
          <p className="text-sm text-muted-foreground mt-1">Try a different search term or browse categories.</p>
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="all">All ({totalCount})</TabsTrigger>
            <TabsTrigger value="leagues">Leagues ({leagueCount})</TabsTrigger>
            <TabsTrigger value="contests">Contests ({contestCount})</TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="space-y-6 mt-4">
            {leagueCount > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground mb-2">Leagues</h2>
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
              </section>
            )}
            {contestCount > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground mb-2">Contests</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {data?.contests.map((contest) => (
                    <ContestDiscoveryCard key={contest.id} contest={contest} />
                  ))}
                </div>
              </section>
            )}
          </TabsContent>

          <TabsContent value="leagues" className="mt-4">
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
            {leagueCount === 0 && <p className="text-center text-muted-foreground py-8">No leagues match your search.</p>}
          </TabsContent>

          <TabsContent value="contests" className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {data?.contests.map((contest) => (
                <ContestDiscoveryCard key={contest.id} contest={contest} />
              ))}
            </div>
            {contestCount === 0 && <p className="text-center text-muted-foreground py-8">No contests match your search.</p>}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
