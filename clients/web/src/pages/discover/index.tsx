import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Sport } from '@poolmaster/shared/domain/enums';
import { ChevronRight } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchBar } from '@/features/discovery/search-bar';
import { LeagueDiscoveryCard } from '@/features/discovery/discovery-cards';
import { ContestDiscoveryCard } from '@/features/discovery/discovery-cards';
import { useTrendingLeagues, usePopularContests, useJoinLeague } from '@/features/discovery/hooks/use-discovery';

const SPORTS = ['ALL', Sport.GOLF, Sport.NFL, Sport.NBA, Sport.F1, Sport.NCAA_BASKETBALL, Sport.SOCCER, Sport.TENNIS, Sport.HORSE_RACING, Sport.NASCAR];

export function Component() {
  const navigate = useNavigate();
  const [sport, setSport] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: trendingLeagues, isLoading: loadingLeagues } = useTrendingLeagues(sport);
  const { data: popularContests, isLoading: loadingContests } = usePopularContests(sport);
  const joinLeague = useJoinLeague();

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="text-center py-8 space-y-4">
        <h1 className="text-3xl font-bold">Discover Your Next Competition</h1>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Find public leagues, open contests, and trending pools across all sports.
        </p>
        <div className="max-w-xl mx-auto">
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            onSubmit={(q) => navigate(`/discover/search?q=${encodeURIComponent(q)}`)}
            placeholder="Find leagues, contests, or events..."
            size="lg"
            autoFocus
          />
        </div>
      </div>

      {/* Sport tabs */}
      <Tabs value={sport} onValueChange={setSport}>
        <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent p-0">
          {SPORTS.map((s) => (
            <TabsTrigger key={s} value={s} className="text-xs px-3 py-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              {s === 'ALL' ? 'All Sports' : s.replace('_', ' ')}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Trending Leagues */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Trending Leagues</h2>
          <Link to="/discover/leagues?sort=trending" className="text-sm text-primary hover:underline flex items-center gap-0.5">
            View all <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
        {loadingLeagues ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-28 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {trendingLeagues?.map((league) => (
              <LeagueDiscoveryCard
                key={league.id}
                league={league}
                onJoin={() => joinLeague.mutate(league.id)}
                isJoining={joinLeague.isPending}
              />
            ))}
          </div>
        )}
      </section>

      {/* Popular Contests */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Popular Contests This Week</h2>
          <Link to="/discover/contests?sort=popular" className="text-sm text-primary hover:underline flex items-center gap-0.5">
            View all <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
        {loadingContests ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-28 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {popularContests?.map((contest) => (
              <ContestDiscoveryCard key={contest.id} contest={contest} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
