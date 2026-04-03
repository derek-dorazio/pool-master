import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Settings,
  LogOut,
  Trophy,
  Plus,
  UserPlus,
  MessageSquare,
  Flame,
  Star,
  Target,
  TrendingUp,
  Award,
  Calendar,
  ChevronDown,
  ChevronRight,
  Send,
  AlertCircle,
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
import { ConfirmDialog, useConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { client, getLeague, listContests, getLeagueRecords, getSeasonSummaries } from '@/lib/api';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import {
  LeagueMembersResponseSchema,
  type LeagueDetailDto,
  type LeagueMemberDto,
} from '@poolmaster/shared/dto';
import type { ContestSummaryDto } from '@poolmaster/shared/dto';

function normalizeRole(role: string | undefined): string {
  return role?.toUpperCase() ?? '';
}

function isCommissionerRole(role: string | undefined): boolean {
  const normalizedRole = normalizeRole(role);
  return normalizedRole === 'OWNER' || normalizedRole === 'COMMISSIONER';
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useLeagueDetail(leagueId: string) {
  return useQuery({
    queryKey: ['league', leagueId],
    queryFn: async (): Promise<LeagueDetailDto> => {
      const { data, error } = await getLeague({ client, path: { id: leagueId } });
      if (error) throw error;
      return (data as any).league;
    },
  });
}

function useLeagueContests(leagueId: string) {
  return useQuery({
    queryKey: ['league-contests', leagueId],
    queryFn: async (): Promise<ContestSummaryDto[]> => {
      const { data, error } = await listContests({ client, path: { id: leagueId } });
      if (error) throw error;
      return (data as any).contests;
    },
  });
}

function useLeagueMembers(leagueId: string) {
  return useQuery({
    queryKey: ['league-members', leagueId],
    queryFn: async (): Promise<LeagueMemberDto[]> => {
      const { data, error } = await client.get({
        url: API_ROUTES.leagues.members(leagueId),
      });
      if (error) throw error;
      return LeagueMembersResponseSchema.parse(data).members;
    },
  });
}

function useLeaveLeague(leagueId: string) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { error } = await client.delete({
        url: API_ROUTES.leagues.leave(leagueId),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast({ title: 'Left league', description: 'You have left the league.' });
      await queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
      await queryClient.invalidateQueries({ queryKey: ['league-members', leagueId] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard', 'leagues'] });
      navigate('/leagues');
    },
  });
}

interface RecordItem {
  id: string;
  category: string;
  holderName: string;
  value: string;
  season?: string;
}

function useLeagueRecords(leagueId: string) {
  return useQuery({
    queryKey: ['league-records', leagueId],
    queryFn: async (): Promise<RecordItem[]> => {
      const { data, error } = await getLeagueRecords({ client, path: { id: leagueId } });
      if (error) throw error;
      return (data as any).records ?? [];
    },
  });
}

interface SeasonSummary {
  id: string;
  season: string;
  year: number;
  contestCount: number;
  results?: Array<{
    id: string;
    contestName: string;
    winnerName: string;
    score: string;
    date: string;
  }>;
}

function useLeagueSeasons(leagueId: string) {
  return useQuery({
    queryKey: ['league-seasons', leagueId],
    queryFn: async (): Promise<SeasonSummary[]> => {
      const { data, error } = await getSeasonSummaries({ client, path: { id: leagueId } });
      if (error) throw error;
      return (data as any).seasons ?? [];
    },
  });
}

// ---------------------------------------------------------------------------
// Status style map
// ---------------------------------------------------------------------------

const contestStatusStyles: Record<string, string> = {
  OPEN: 'bg-green-100 text-green-800 border-green-200',
  DRAFTING: 'bg-purple-100 text-purple-800 border-purple-200',
  ACTIVE: 'bg-blue-100 text-blue-800 border-blue-200',
  COMPLETED: 'bg-gray-100 text-gray-800 border-gray-200',
};


function getRecordIcon(category: string) {
  const lower = category.toLowerCase();
  if (lower.includes('streak')) return Flame;
  if (lower.includes('draft')) return Star;
  if (lower.includes('accura')) return Target;
  if (lower.includes('score') || lower.includes('season')) return TrendingUp;
  if (lower.includes('win')) return Award;
  return Trophy;
}

// ---------------------------------------------------------------------------
// Tab components
// ---------------------------------------------------------------------------

function OverviewTab({ league, leagueId }: { league: LeagueDetailDto; leagueId: string }) {
  const { data: contests = [] } = useLeagueContests(leagueId);
  const isCommissioner = isCommissionerRole(league.role);

  return (
    <div className="space-y-6">
      {/* Commissioner quick actions */}
      {isCommissioner && (
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
        {contests.length === 0 ? (
          <p className="text-muted-foreground text-sm">No active contests.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {contests.map((contest) => (
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
                  <div className="text-sm text-muted-foreground">
                    {contest.entryCount ?? 0} entries
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Recent activity placeholder */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Recent Activity
        </h3>
        <p className="text-muted-foreground text-sm">No recent activity to show.</p>
      </div>
    </div>
  );
}

function ContestsTab({ leagueId }: { leagueId: string }) {
  const { data: contests = [], isLoading } = useLeagueContests(leagueId);

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
      {isLoading ? (
        <p className="text-muted-foreground text-sm py-8 text-center">Loading contests...</p>
      ) : contests.length === 0 ? (
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
                    <th className="p-4 font-medium hidden md:table-cell">Type</th>
                    <th className="p-4 font-medium">Status</th>
                    <th className="p-4 font-medium hidden sm:table-cell">Entries</th>
                    <th className="p-4 font-medium hidden md:table-cell">Start Date</th>
                  </tr>
                </thead>
                <tbody>
                  {contests.map((contest) => (
                    <tr key={contest.id} className="border-b last:border-0">
                      <td className="p-4">
                        <Link
                          to={`/contests/${contest.id}`}
                          className="font-medium hover:underline"
                        >
                          {contest.name}
                        </Link>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground hidden md:table-cell">
                        {contest.contestType}
                      </td>
                      <td className="p-4">
                        <Badge className={cn('capitalize', contestStatusStyles[contest.status] ?? 'bg-gray-100 text-gray-800')}>
                          {contest.status}
                        </Badge>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground hidden sm:table-cell">
                        {contest.entryCount ?? 0}
                      </td>
                      <td className="p-4 text-sm text-muted-foreground hidden md:table-cell">
                        {contest.startsAt
                          ? new Date(contest.startsAt).toLocaleDateString()
                          : '-'}
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
  const { data: members = [], isLoading } = useLeagueMembers(leagueId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{members.length} Members</h3>
        <Button size="sm" variant="outline" asChild>
          <Link to={`/leagues/${leagueId}/members`}>
            <UserPlus className="h-4 w-4 mr-1" />
            Invite Member
          </Link>
        </Button>
      </div>
      {isLoading ? (
        <p className="text-muted-foreground text-sm py-8 text-center">Loading members...</p>
      ) : (
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
                  {members.map((member) => {
                    const initials = member.displayName
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase();
                    return (
                      <tr key={member.id} className="border-b last:border-0">
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-sm">
                              {initials}
                            </div>
                            <div>
                              <div className="font-medium">{member.displayName}</div>
                              {member.joinedAt && (
                                <div className="text-xs text-muted-foreground sm:hidden">
                                  {new Date(member.joinedAt).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="p-4">
                          <Badge
                            className={cn(
                              normalizeRole(member.role) === 'OWNER'
                                ? 'bg-amber-100 text-amber-800 border-amber-200'
                                : normalizeRole(member.role) === 'COMMISSIONER'
                                  ? 'bg-purple-100 text-purple-800 border-purple-200'
                                  : 'bg-blue-100 text-blue-800 border-blue-200',
                            )}
                          >
                            {normalizeRole(member.role) === 'OWNER'
                              ? 'Owner'
                              : normalizeRole(member.role) === 'COMMISSIONER'
                                ? 'Commissioner'
                                : normalizeRole(member.role) === 'MANAGER'
                                  ? 'Manager'
                                  : 'Viewer'}
                          </Badge>
                        </td>
                        <td className="p-4 text-sm text-muted-foreground hidden sm:table-cell">
                          {member.joinedAt
                            ? new Date(member.joinedAt).toLocaleDateString()
                            : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
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

      {/* Empty state — feed API not yet wired */}
      <p className="text-muted-foreground text-sm text-center py-8">No posts yet. Be the first to share!</p>
    </div>
  );
}

function RecordsTab({ leagueId }: { leagueId: string }) {
  const { data: records = [], isLoading } = useLeagueRecords(leagueId);

  if (isLoading) {
    return <p className="text-muted-foreground text-sm py-8 text-center">Loading records...</p>;
  }

  if (records.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">League Records</h3>
        <p className="text-muted-foreground text-sm">No records yet. Play some contests to earn records!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">League Records</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {records.map((record) => {
          const Icon = getRecordIcon(record.category);
          return (
            <Card key={record.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <CardTitle className="text-base">{record.category}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  <div className="text-lg font-bold">{record.value}</div>
                  <div className="text-sm text-muted-foreground">
                    Held by <span className="font-medium text-foreground">{record.holderName}</span>
                  </div>
                  {record.season && (
                    <div className="text-xs text-muted-foreground">{record.season}</div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function SeasonAccordion({ season }: { season: SeasonSummary }) {
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
            <div className="font-semibold">{season.season}</div>
            <div className="text-sm text-muted-foreground">
              {season.contestCount} contest{season.contestCount !== 1 ? 's' : ''}
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
            {(season.results ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No results available for this season.</p>
            ) : (
              season.results!.map((result) => (
                <div
                  key={result.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                      <Trophy className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-medium text-sm">{result.contestName}</div>
                      <div className="text-xs text-muted-foreground">{result.date}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">{result.winnerName}</div>
                    <Badge variant="secondary" className="text-xs">{result.score}</Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function HistoryTab({ leagueId }: { leagueId: string }) {
  const { data: seasons = [], isLoading } = useLeagueSeasons(leagueId);

  if (isLoading) {
    return <p className="text-muted-foreground text-sm py-8 text-center">Loading history...</p>;
  }

  if (seasons.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">League History</h3>
        <p className="text-muted-foreground text-sm">No seasons completed yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">League History</h3>
      <div className="space-y-3">
        {seasons.map((season) => (
          <SeasonAccordion key={season.id} season={season} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function Component() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { data: league, isLoading, isError } = useLeagueDetail(leagueId!);
  const leaveLeague = useLeaveLeague(leagueId!);
  const leaveDialog = useConfirmDialog();

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-xl font-semibold mb-2">Failed to load league</h2>
        <p className="text-muted-foreground">Something went wrong. Please try again later.</p>
      </div>
    );
  }

  if (isLoading || !league) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-muted-foreground">Loading league...</p>
      </div>
    );
  }

  const isCommissioner = isCommissionerRole(league.role);

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
          </div>
        </div>
        <div>
          {isCommissioner ? (
            <Button variant="outline" asChild>
              <Link to={`/leagues/${league.id}/settings`}>
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Link>
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={async () => {
                const confirmed = await leaveDialog.confirm(
                  'Leave League',
                  'Leave this league? You will lose access to league content until you are invited again.',
                  { confirmLabel: 'Leave', variant: 'destructive' },
                );

                if (!confirmed) return;

                try {
                  await leaveLeague.mutateAsync();
                } catch (error) {
                  toast({
                    title: 'Unable to leave league',
                    description: error instanceof Error ? error.message : 'Please try again.',
                  });
                }
              }}
              disabled={leaveLeague.isPending}
            >
              <LogOut className="h-4 w-4 mr-2" />
              {leaveLeague.isPending ? 'Leaving...' : 'Leave League'}
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
          <OverviewTab league={league} leagueId={leagueId!} />
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
          <RecordsTab leagueId={league.id} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab leagueId={league.id} />
        </TabsContent>
      </Tabs>
      <ConfirmDialog
        open={leaveDialog.open}
        title={leaveDialog.title}
        description={leaveDialog.description}
        confirmLabel={leaveDialog.confirmLabel}
        variant={leaveDialog.variant}
        onConfirm={leaveDialog.onConfirm}
        onCancel={leaveDialog.onCancel}
      />
    </div>
  );
}
