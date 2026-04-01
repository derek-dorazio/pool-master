import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Users,
  Settings,
  LogOut,
  Trophy,
  Plus,
  UserPlus,
  MessageSquare,
  CalendarClock,
  Flame,
  Star,
  Target,
  TrendingUp,
  Award,
  Calendar,
  ChevronDown,
  ChevronRight,
  Heart,
  Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

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

const mockContests = [
  {
    id: 'contest-1',
    name: 'Week 14 Pick\'em',
    sport: 'NFL',
    type: 'Pick\'em',
    status: 'active' as const,
    entries: 12,
    startDate: 'Dec 8, 2025',
  },
  {
    id: 'contest-2',
    name: 'Survivor Pool 2025',
    sport: 'NFL',
    type: 'Survivor',
    status: 'active' as const,
    entries: 10,
    startDate: 'Sep 7, 2025',
  },
  {
    id: 'contest-3',
    name: 'Playoff Fantasy Draft',
    sport: 'NFL',
    type: 'Fantasy',
    status: 'open' as const,
    entries: 4,
    startDate: 'Apr 5, 2026',
  },
  {
    id: 'contest-4',
    name: 'March Madness Bracket',
    sport: 'NCAA',
    type: 'Bracket',
    status: 'completed' as const,
    entries: 12,
    startDate: 'Mar 19, 2026',
  },
];

const contestStatusStyles: Record<string, string> = {
  open: 'bg-green-100 text-green-800 border-green-200',
  drafting: 'bg-purple-100 text-purple-800 border-purple-200',
  active: 'bg-blue-100 text-blue-800 border-blue-200',
  completed: 'bg-gray-100 text-gray-800 border-gray-200',
};

const mockMembersDetail = [
  { id: 'm1', name: 'Mike Johnson', initials: 'MJ', role: 'commissioner' as const, joinDate: 'Aug 15, 2025' },
  { id: 'm2', name: 'Sarah Kim', initials: 'SK', role: 'member' as const, joinDate: 'Aug 16, 2025' },
  { id: 'm3', name: 'Dan Miller', initials: 'DM', role: 'member' as const, joinDate: 'Aug 20, 2025' },
  { id: 'm4', name: 'Chris Park', initials: 'CP', role: 'member' as const, joinDate: 'Sep 1, 2025' },
  { id: 'm5', name: 'Amy Lee', initials: 'AL', role: 'member' as const, joinDate: 'Sep 5, 2025' },
  { id: 'm6', name: 'Tom Brown', initials: 'TB', role: 'member' as const, joinDate: 'Oct 12, 2025' },
  { id: 'm7', name: 'Lisa Chen', initials: 'LC', role: 'member' as const, joinDate: 'Nov 3, 2025' },
  { id: 'm8', name: 'Jake Wilson', initials: 'JW', role: 'member' as const, joinDate: 'Nov 20, 2025' },
];

const mockFeedItems = [
  {
    id: 'f1',
    type: 'announcement' as const,
    author: 'Mike Johnson',
    initials: 'MJ',
    content: 'Reminder: Playoff Fantasy Draft is scheduled for April 5th at 6 PM. Make sure you\'re available!',
    timestamp: '1 hour ago',
    likes: 5,
  },
  {
    id: 'f2',
    type: 'post' as const,
    author: 'Sarah Kim',
    initials: 'SK',
    content: 'Who else is taking the Chiefs this week? Bold move!',
    timestamp: '5 hours ago',
    likes: 3,
  },
  {
    id: 'f3',
    type: 'event' as const,
    author: 'System',
    initials: 'S',
    content: 'Draft completed for Playoff Fantasy Draft. 12 participants made their picks.',
    timestamp: '1 day ago',
    likes: 0,
  },
  {
    id: 'f4',
    type: 'event' as const,
    author: 'System',
    initials: 'S',
    content: 'Scores updated for Week 14 Pick\'em. Sarah K. takes the lead with 87 points!',
    timestamp: '2 days ago',
    likes: 0,
  },
  {
    id: 'f5',
    type: 'event' as const,
    author: 'System',
    initials: 'S',
    content: 'Jake Wilson joined the league. Welcome!',
    timestamp: '3 days ago',
    likes: 2,
  },
  {
    id: 'f6',
    type: 'post' as const,
    author: 'Dan Miller',
    initials: 'DM',
    content: 'Just locked in all 16 picks. Feeling confident this week.',
    timestamp: '4 days ago',
    likes: 1,
  },
];

const mockRecords = [
  { id: 'r1', name: 'Best Weekly Score', holder: 'Sarah Kim', value: '15/16 correct', icon: 'trophy' as const, date: 'Week 8, 2025' },
  { id: 'r2', name: 'Most Contest Wins', holder: 'Dan Miller', value: '7 wins', icon: 'award' as const, date: 'All-time' },
  { id: 'r3', name: 'Longest Win Streak', holder: 'Mike Johnson', value: '4 weeks', icon: 'flame' as const, date: 'Weeks 5-8, 2025' },
  { id: 'r4', name: 'Best Draft Pick', holder: 'Chris Park', value: 'Patrick Mahomes (Rd 3)', icon: 'star' as const, date: 'Draft 2025' },
  { id: 'r5', name: 'Highest Season Score', holder: 'Sarah Kim', value: '187 points', icon: 'trending' as const, date: '2025 Season' },
  { id: 'r6', name: 'Most Accurate Picker', holder: 'Amy Lee', value: '72% accuracy', icon: 'target' as const, date: '2025 Season' },
];

const recordIconMap = {
  trophy: Trophy,
  flame: Flame,
  star: Star,
  target: Target,
  trending: TrendingUp,
  award: Award,
};

const mockSeasons = [
  {
    id: 's1',
    name: '2025-26 Season',
    contestResults: [
      { id: 'cr1', name: 'Week 14 Pick\'em', winner: 'Sarah Kim', score: '14/16 correct', date: 'Dec 8, 2025' },
      { id: 'cr2', name: 'Survivor Pool 2025', winner: 'Dan Miller', score: 'Survived 13 weeks', date: 'Nov 30, 2025' },
      { id: 'cr3', name: 'Fantasy Draft League', winner: 'Chris Park', score: '1,247 total points', date: 'Jan 15, 2026' },
    ],
  },
  {
    id: 's2',
    name: '2024-25 Season',
    contestResults: [
      { id: 'cr4', name: 'Season-Long Pick\'em', winner: 'Mike Johnson', score: '178/256 correct', date: 'Feb 10, 2025' },
      { id: 'cr5', name: 'Playoff Bracket Challenge', winner: 'Amy Lee', score: '8/11 correct', date: 'Feb 9, 2025' },
      { id: 'cr6', name: 'Survivor Pool 2024', winner: 'Tom Brown', score: 'Survived 11 weeks', date: 'Nov 24, 2024' },
    ],
  },
  {
    id: 's3',
    name: '2023-24 Season',
    contestResults: [
      { id: 'cr7', name: 'Season-Long Pick\'em', winner: 'Sarah Kim', score: '182/256 correct', date: 'Feb 11, 2024' },
      { id: 'cr8', name: 'Survivor Pool 2023', winner: 'Dan Miller', score: 'Survived 15 weeks', date: 'Dec 17, 2023' },
    ],
  },
];

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

function ContestsTab({ leagueId: _leagueId }: { leagueId: string }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">League Contests</h3>
        <Button size="sm" asChild>
          <Link to="/contests/create">
            <Plus className="h-4 w-4 mr-1" />
            Create Contest
          </Link>
        </Button>
      </div>
      {mockContests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Trophy className="h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No contests yet. Create your first contest!</p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-sm text-muted-foreground">
                    <th className="p-4 font-medium">Contest</th>
                    <th className="p-4 font-medium hidden sm:table-cell">Sport</th>
                    <th className="p-4 font-medium hidden md:table-cell">Type</th>
                    <th className="p-4 font-medium">Status</th>
                    <th className="p-4 font-medium hidden sm:table-cell">Entries</th>
                    <th className="p-4 font-medium hidden md:table-cell">Start Date</th>
                  </tr>
                </thead>
                <tbody>
                  {mockContests.map((contest) => (
                    <tr key={contest.id} className="border-b last:border-0">
                      <td className="p-4">
                        <Link
                          to={`/contests/${contest.id}`}
                          className="font-medium hover:underline"
                        >
                          {contest.name}
                        </Link>
                      </td>
                      <td className="p-4 hidden sm:table-cell">
                        <Badge variant="outline">{contest.sport}</Badge>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground hidden md:table-cell">
                        {contest.type}
                      </td>
                      <td className="p-4">
                        <Badge className={cn('capitalize', contestStatusStyles[contest.status])}>
                          {contest.status}
                        </Badge>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground hidden sm:table-cell">
                        {contest.entries}
                      </td>
                      <td className="p-4 text-sm text-muted-foreground hidden md:table-cell">
                        {contest.startDate}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MembersTab({ leagueId }: { leagueId: string }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{mockMembersDetail.length} Members</h3>
        <Button size="sm" variant="outline" asChild>
          <Link to={`/leagues/${leagueId}/members`}>
            <UserPlus className="h-4 w-4 mr-1" />
            Invite Member
          </Link>
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="p-4 font-medium">Member</th>
                  <th className="p-4 font-medium">Role</th>
                  <th className="p-4 font-medium hidden sm:table-cell">Joined</th>
                </tr>
              </thead>
              <tbody>
                {mockMembersDetail.map((member) => (
                  <tr key={member.id} className="border-b last:border-0">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-sm">
                          {member.initials}
                        </div>
                        <div>
                          <div className="font-medium">{member.name}</div>
                          <div className="text-xs text-muted-foreground sm:hidden">
                            {member.joinDate}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <Badge
                        className={cn(
                          member.role === 'commissioner'
                            ? 'bg-amber-100 text-amber-800 border-amber-200'
                            : 'bg-blue-100 text-blue-800 border-blue-200',
                        )}
                      >
                        {member.role === 'commissioner' ? 'Commissioner' : 'Member'}
                      </Badge>
                    </td>
                    <td className="p-4 text-sm text-muted-foreground hidden sm:table-cell">
                      {member.joinDate}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FeedTab() {
  return (
    <div className="space-y-4">
      {/* Compose box */}
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-sm">
              You
            </div>
            <div className="flex flex-1 gap-2">
              <Input placeholder="Share something with the league..." className="flex-1" />
              <Button size="sm">
                <Send className="h-4 w-4 mr-1" />
                Post
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Feed items */}
      <div className="space-y-3">
        {mockFeedItems.map((item) => (
          <Card key={item.id}>
            <CardContent className="p-4">
              <div className="flex gap-3">
                <div className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-medium text-sm',
                  item.type === 'event' ? 'bg-blue-100 text-blue-700' :
                  item.type === 'announcement' ? 'bg-amber-100 text-amber-700' :
                  'bg-muted',
                )}>
                  {item.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{item.author}</span>
                    {item.type === 'announcement' && (
                      <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs">
                        Announcement
                      </Badge>
                    )}
                    {item.type === 'event' && (
                      <Badge variant="secondary" className="text-xs">Event</Badge>
                    )}
                  </div>
                  <p className="text-sm mt-1">{item.content}</p>
                  <div className="flex items-center gap-4 mt-2">
                    <span className="text-xs text-muted-foreground">{item.timestamp}</span>
                    {item.likes > 0 && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Heart className="h-3 w-3" />
                        {item.likes}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RecordsTab() {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">League Records</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {mockRecords.map((record) => {
          const Icon = recordIconMap[record.icon];
          return (
            <Card key={record.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <CardTitle className="text-base">{record.name}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  <div className="text-lg font-bold">{record.value}</div>
                  <div className="text-sm text-muted-foreground">
                    Held by <span className="font-medium text-foreground">{record.holder}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{record.date}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function SeasonAccordion({ season }: { season: typeof mockSeasons[number] }) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-4 text-left hover:bg-accent/50 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <div>
            <div className="font-semibold">{season.name}</div>
            <div className="text-sm text-muted-foreground">
              {season.contestResults.length} contest{season.contestResults.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
        {open ? (
          <ChevronDown className="h-5 w-5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        )}
      </button>
      {open && (
        <CardContent className="pt-0 pb-4">
          <div className="space-y-3 border-t pt-4">
            {season.contestResults.map((result) => (
              <div
                key={result.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                    <Trophy className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-medium text-sm">{result.name}</div>
                    <div className="text-xs text-muted-foreground">{result.date}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium">{result.winner}</div>
                  <Badge variant="secondary" className="text-xs">{result.score}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function HistoryTab() {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">League History</h3>
      <div className="space-y-3">
        {mockSeasons.map((season) => (
          <SeasonAccordion key={season.id} season={season} />
        ))}
      </div>
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
          <ContestsTab leagueId={league.id} />
        </TabsContent>
        <TabsContent value="members">
          <MembersTab leagueId={league.id} />
        </TabsContent>
        <TabsContent value="feed">
          <FeedTab />
        </TabsContent>
        <TabsContent value="records">
          <RecordsTab />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
