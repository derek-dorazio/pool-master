import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  LayoutGrid,
  List,
  Users,
  Trophy,
  Clock,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

type SortOption = 'activity' | 'name' | 'created';
type ViewMode = 'grid' | 'list';

interface League {
  id: string;
  name: string;
  role: 'commissioner' | 'member';
  memberCount: number;
  activeContests: number;
  lastActive: string;
  lastActiveDate: Date;
  createdAt: Date;
}

const mockLeagues: League[] = [
  {
    id: 'league-1',
    name: 'Sunday Gridiron League',
    role: 'commissioner',
    memberCount: 12,
    activeContests: 2,
    lastActive: '2 hours ago',
    lastActiveDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
    createdAt: new Date('2025-08-15'),
  },
  {
    id: 'league-2',
    name: 'Hoop Dreams',
    role: 'member',
    memberCount: 8,
    activeContests: 1,
    lastActive: '1 day ago',
    lastActiveDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    createdAt: new Date('2025-10-01'),
  },
  {
    id: 'league-3',
    name: 'Fairway Legends',
    role: 'member',
    memberCount: 16,
    activeContests: 3,
    lastActive: '5 minutes ago',
    lastActiveDate: new Date(Date.now() - 5 * 60 * 1000),
    createdAt: new Date('2025-03-10'),
  },
  {
    id: 'league-4',
    name: 'Pit Lane Picks',
    role: 'commissioner',
    memberCount: 6,
    activeContests: 0,
    lastActive: '3 days ago',
    lastActiveDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    createdAt: new Date('2026-01-20'),
  },
];

function useLeagues() {
  return useQuery({
    queryKey: ['leagues'],
    queryFn: async () => mockLeagues,
    initialData: mockLeagues,
  });
}

function LeagueCard({ league, viewMode }: { league: League; viewMode: ViewMode }) {
  if (viewMode === 'list') {
    return (
      <Card>
        <CardContent className="flex items-center gap-4 p-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Link
                to={`/leagues/${league.id}`}
                className="font-bold hover:underline truncate"
              >
                {league.name}
              </Link>
              <Badge
                className={cn(
                  league.role === 'commissioner'
                    ? 'bg-amber-100 text-amber-800 border-amber-200'
                    : 'bg-blue-100 text-blue-800 border-blue-200',
                )}
              >
                {league.role === 'commissioner' ? 'Commissioner' : 'Member'}
              </Badge>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" />
                {league.memberCount} members
              </span>
              <span className="flex items-center gap-1">
                <Trophy className="h-3.5 w-3.5" />
                {league.activeContests} active contests
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {league.lastActive}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <Badge
            className={cn(
              league.role === 'commissioner'
                ? 'bg-amber-100 text-amber-800 border-amber-200'
                : 'bg-blue-100 text-blue-800 border-blue-200',
            )}
          >
            {league.role === 'commissioner' ? 'Commissioner' : 'Member'}
          </Badge>
        </div>
        <Link
          to={`/leagues/${league.id}`}
          className="text-lg font-bold hover:underline block mb-2"
        >
          {league.name}
        </Link>
        <div className="space-y-1.5 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            <span>{league.memberCount} members</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Trophy className="h-3.5 w-3.5" />
            <span>{league.activeContests} active contests</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span>{league.lastActive}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted p-6 mb-6">
        <Trophy className="h-12 w-12 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold mb-2">You're not in any leagues yet</h2>
      <p className="text-muted-foreground mb-6 max-w-md">
        Create your own league and invite friends, or discover public leagues to join.
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <Link to="/leagues/create">Create a League</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/discover/leagues">Discover Leagues</Link>
        </Button>
      </div>
    </div>
  );
}

export function Component() {
  const { data: leagues = [] } = useLeagues();
  const [sortBy, setSortBy] = useState<SortOption>('activity');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const filteredLeagues = [...leagues].sort((a, b) => {
    switch (sortBy) {
      case 'activity':
        return b.lastActiveDate.getTime() - a.lastActiveDate.getTime();
      case 'name':
        return a.name.localeCompare(b.name);
      case 'created':
        return b.createdAt.getTime() - a.createdAt.getTime();
      default:
        return 0;
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">My Leagues</h1>
        <Button asChild>
          <Link to="/leagues/create">
            <Plus className="h-4 w-4 mr-2" />
            Create League
          </Link>
        </Button>
      </div>

      {leagues.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="w-40"
            >
              <option value="activity">Activity</option>
              <option value="name">Name</option>
              <option value="created">Created</option>
            </Select>

            <div className="ml-auto flex items-center gap-1 rounded-md border p-1">
              <button
                onClick={() => setViewMode('grid')}
                className={cn(
                  'rounded p-1.5 transition-colors',
                  viewMode === 'grid'
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  'rounded p-1.5 transition-colors',
                  viewMode === 'list'
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>

          {filteredLeagues.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <Search className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">
                No leagues match your filters. Try adjusting your search.
              </p>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredLeagues.map((league) => (
                <LeagueCard key={league.id} league={league} viewMode="grid" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredLeagues.map((league) => (
                <LeagueCard key={league.id} league={league} viewMode="list" />
              ))}
            </div>
          )}
        </>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}
