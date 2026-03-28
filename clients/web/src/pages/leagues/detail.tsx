import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Users,
  Settings,
  LogOut,
  Trophy,
  Clock,
  Plus,
  UserPlus,
  MessageSquare,
  CalendarClock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface LeagueDetail {
  id: string;
  name: string;
  memberCount: number;
  commissioner: string;
  isCommissioner: boolean;
  description: string;
  contests: Array<{
    id: string;
    name: string;
    status: 'active' | 'upcoming' | 'completed';
    standings: Array<{ name: string; points: number }>;
  }>;
  members: Array<{ id: string; name: string; role: string }>;
  feedItems: Array<{
    id: string;
    type: 'event' | 'post';
    author: string;
    content: string;
    timestamp: string;
  }>;
  nextDraft: { contestName: string; date: string } | null;
}

const mockLeague: LeagueDetail = {
  id: 'league-1',
  name: 'Sunday Gridiron League',
  memberCount: 12,
  commissioner: 'Mike Johnson',
  isCommissioner: true,
  description: 'A competitive NFL pool for friends and family. Weekly picks, survivor pools, and more.',
  contests: [
    {
      id: 'contest-1',
      name: 'Week 14 Pick\'em',
      status: 'active',
      standings: [
        { name: 'Sarah K.', points: 87 },
        { name: 'Dan M.', points: 82 },
        { name: 'You', points: 79 },
      ],
    },
    {
      id: 'contest-2',
      name: 'Survivor Pool 2025',
      status: 'active',
      standings: [
        { name: 'You', points: 12 },
        { name: 'Chris P.', points: 12 },
        { name: 'Amy L.', points: 11 },
      ],
    },
  ],
  members: [
    { id: 'm1', name: 'Mike Johnson', role: 'commissioner' },
    { id: 'm2', name: 'Sarah Kim', role: 'member' },
    { id: 'm3', name: 'Dan Miller', role: 'member' },
    { id: 'm4', name: 'Chris Park', role: 'member' },
    { id: 'm5', name: 'Amy Lee', role: 'member' },
    { id: 'm6', name: 'Tom Brown', role: 'member' },
    { id: 'm7', name: 'Lisa Chen', role: 'member' },
    { id: 'm8', name: 'Jake Wilson', role: 'member' },
  ],
  feedItems: [
    {
      id: 'f1',
      type: 'event',
      author: 'System',
      content: 'Week 14 Pick\'em is now live — make your picks!',
      timestamp: '2 hours ago',
    },
    {
      id: 'f2',
      type: 'post',
      author: 'Sarah K.',
      content: 'Who else is taking the Chiefs this week? Bold move!',
      timestamp: '5 hours ago',
    },
    {
      id: 'f3',
      type: 'event',
      author: 'System',
      content: 'Dan M. locked in all 16 picks for the week.',
      timestamp: '1 day ago',
    },
  ],
  nextDraft: {
    contestName: 'Playoff Fantasy Draft',
    date: '2026-04-05T18:00:00Z',
  },
};

function useLeagueDetail(leagueId: string) {
  return useQuery({
    queryKey: ['league', leagueId],
    queryFn: async () => mockLeague,
    initialData: mockLeague,
  });
}

function OverviewTab({ league }: { league: LeagueDetail }) {
  return (
    <div className="space-y-6">
      {/* Commissioner quick actions */}
      {league.isCommissioner && (
        <div className="flex gap-3">
          <Button size="sm" asChild>
            <Link to="/contests/create">
              <Plus className="h-4 w-4 mr-1" />
              Create Contest
            </Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to={`/leagues/${league.id}/members`}>
              <UserPlus className="h-4 w-4 mr-1" />
              Invite Members
            </Link>
          </Button>
        </div>
      )}

      {/* Active contests */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Trophy className="h-5 w-5" />
          Active Contests
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {league.contests.map((contest) => (
            <Card key={contest.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    <Link
                      to={`/contests/${contest.id}`}
                      className="hover:underline"
                    >
                      {contest.name}
                    </Link>
                  </CardTitle>
                  <Badge variant="secondary" className="text-xs capitalize">
                    {contest.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {contest.standings.map((s, i) => (
                    <div
                      key={s.name}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-muted-foreground">
                        {i + 1}. {s.name}
                      </span>
                      <span className="font-medium">{s.points} pts</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Next draft */}
      {league.nextDraft && (
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <CalendarClock className="h-8 w-8 text-muted-foreground" />
            <div>
              <div className="font-semibold">{league.nextDraft.contestName}</div>
              <div className="text-sm text-muted-foreground">
                Draft scheduled for{' '}
                {new Date(league.nextDraft.date).toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent feed */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Recent Activity
        </h3>
        <div className="space-y-2">
          {league.feedItems.map((item) => (
            <div key={item.id} className="flex gap-3 rounded-lg border p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                {item.author[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm">
                  <span className="font-medium">{item.author}</span>{' '}
                  <span className="text-muted-foreground">{item.content}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {item.timestamp}
                </div>
              </div>
            </div>
          ))}
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/leagues/${league.id}/feed`}>View all activity</Link>
        </Button>
      </div>
    </div>
  );
}

function PlaceholderTab({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Clock className="h-8 w-8 text-muted-foreground mb-3" />
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}

export function Component() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { data: league } = useLeagueDetail(leagueId!);

  if (!league) return null;

  return (
    <div className="space-y-6">
      {/* League header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">{league.name}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {league.memberCount} members
            </span>
            <span>Commissioner: {league.commissioner}</span>
          </div>
        </div>
        <div>
          {league.isCommissioner ? (
            <Button variant="outline" asChild>
              <Link to={`/leagues/${league.id}/settings`}>
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Link>
            </Button>
          ) : (
            <Button variant="outline">
              <LogOut className="h-4 w-4 mr-2" />
              Leave League
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contests">Contests</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="feed">Feed</TabsTrigger>
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab league={league} />
        </TabsContent>
        <TabsContent value="contests">
          <PlaceholderTab message="Coming soon — League contests will appear here." />
        </TabsContent>
        <TabsContent value="members">
          <PlaceholderTab message="Coming soon — Member list and management will appear here." />
        </TabsContent>
        <TabsContent value="feed">
          <PlaceholderTab message="Coming soon — League activity feed will appear here." />
        </TabsContent>
        <TabsContent value="records">
          <PlaceholderTab message="Coming soon — League records will appear here." />
        </TabsContent>
        <TabsContent value="history">
          <PlaceholderTab message="Coming soon — League history will appear here." />
        </TabsContent>
      </Tabs>
    </div>
  );
}
