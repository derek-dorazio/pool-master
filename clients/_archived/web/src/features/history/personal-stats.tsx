import { useQuery } from '@tanstack/react-query';
import { Trophy, Target, Flame, TrendingUp, DollarSign, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { client, getMemberStats } from '@/lib/api';

interface PersonalStats {
  totalContests: number;
  totalWins: number;
  winRate: number;
  totalTop3: number;
  avgPointsPerContest: number;
  highestScore: { score: number; contestName: string };
  currentStreak: { type: 'WIN' | 'LOSS'; length: number } | null;
  netWinnings: number;
  avgPercentileRank: number;
  sportBreakdown: Array<{ sport: string; contests: number; wins: number; winRate: number }>;
}

function usePersonalStats(leagueId: string, memberId: string) {
  return useQuery({
    queryKey: ['history', 'personal-stats', leagueId, memberId],
    queryFn: async () => {
      const { data, error } = await getMemberStats({ client, path: { id: leagueId, mid: memberId } });
      if (error) throw error;
      return data as unknown as PersonalStats;
    },
    staleTime: 5 * 60 * 1000,
  });
}

const sportEmoji: Record<string, string> = {
  GOLF: '\u26F3', NFL: '\uD83C\uDFC8', NBA: '\uD83C\uDFC0', F1: '\uD83C\uDFCE\uFE0F',
  NCAA_BASKETBALL: '\uD83C\uDFC0', SOCCER: '\u26BD', NHL: '\uD83C\uDFD2',
  TENNIS: '\uD83C\uDFBE', HORSE_RACING: '\uD83C\uDFC7',
};

interface PersonalStatsWidgetProps {
  leagueId: string;
  memberId: string;
}

export function PersonalStatsWidget({ leagueId, memberId }: PersonalStatsWidgetProps) {
  const { data: stats, isLoading } = usePersonalStats(leagueId, memberId);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <StatCard icon={Trophy} label="Wins" value={stats.totalWins.toString()} detail={`${(stats.winRate * 100).toFixed(0)}% win rate`} />
        <StatCard icon={Target} label="Top 3 Finishes" value={stats.totalTop3.toString()} detail={`of ${stats.totalContests} contests`} />
        <StatCard icon={TrendingUp} label="Avg Score" value={stats.avgPointsPerContest.toFixed(1)} detail="points per contest" />
        <StatCard icon={BarChart3} label="Avg Percentile" value={`${stats.avgPercentileRank.toFixed(0)}%`} detail="finish percentile" />
        <StatCard icon={Trophy} label="Personal Best" value={stats.highestScore.score.toString()} detail={stats.highestScore.contestName} />
        <StatCard icon={DollarSign} label="Net Winnings" value={`$${stats.netWinnings}`} detail="prizes - fees" />
        {stats.currentStreak && (
          <StatCard
            icon={Flame}
            label="Current Streak"
            value={`${stats.currentStreak.length} ${stats.currentStreak.type === 'WIN' ? 'W' : 'L'}`}
            detail={stats.currentStreak.type === 'WIN' ? 'consecutive wins' : 'consecutive losses'}
            highlight={stats.currentStreak.type === 'WIN'}
          />
        )}
        <StatCard icon={Trophy} label="Total Contests" value={stats.totalContests.toString()} detail="entered" />
      </div>

      {/* Sport breakdown */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">By Sport</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {stats.sportBreakdown.map((sport) => (
              <div key={sport.sport} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base">{sportEmoji[sport.sport] ?? '\uD83C\uDFC6'}</span>
                  <span className="text-sm">{sport.sport.replace('_', ' ')}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{sport.contests} contests</span>
                  <Badge variant={sport.wins > 0 ? 'default' : 'outline'} className="text-xs">
                    {sport.wins}W ({(sport.winRate * 100).toFixed(0)}%)
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  highlight,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? 'border-primary/50' : ''}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon className="h-4 w-4 text-primary" />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <p className="text-xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>
      </CardContent>
    </Card>
  );
}
