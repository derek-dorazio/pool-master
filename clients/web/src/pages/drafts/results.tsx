import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Share2, ChevronDown, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useState } from 'react';
import { api } from '@/lib/api-client';

interface DraftRecap {
  id: string;
  contestName: string;
  completedAt: string;
  totalPicks: number;
  totalTeams: number;
  teams: Array<{ id: string; name: string; picks: Array<{ name: string; position: string; team: string; round: number; pickNumber: number }> }>;
  picks: Array<{ pickNumber: number; round: number; entryName: string; participantName: string; position: string; team: string }>;
  analysis: {
    bestValue: Array<{ name: string; ranking: number; pickNumber: number; delta: number }>;
    biggestReaches: Array<{ name: string; ranking: number; pickNumber: number; delta: number }>;
  };
}

export function Component() {
  const { draftId } = useParams<{ draftId: string }>();
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);

  const { data: recap, isLoading } = useQuery({
    queryKey: ['drafts', draftId, 'recap'],
    queryFn: () => api.get<DraftRecap>(`/v1/drafts/${draftId}`),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !recap) {
    return <div className="space-y-6"><div className="h-8 w-64 rounded bg-muted animate-pulse" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{recap.contestName} — Draft Results</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Completed {new Date(recap.completedAt).toLocaleDateString()} &middot; {recap.totalPicks} picks &middot; {recap.totalTeams} teams
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm"><Share2 className="h-4 w-4 mr-1" /> Share</Button>
          <Button variant="outline" size="sm"><Download className="h-4 w-4 mr-1" /> Export CSV</Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">All Picks</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b">
                <th className="text-left px-3 py-2 font-medium">#</th>
                <th className="text-left px-3 py-2 font-medium">Rd</th>
                <th className="text-left px-3 py-2 font-medium">Team</th>
                <th className="text-left px-3 py-2 font-medium">Player</th>
                <th className="text-left px-3 py-2 font-medium">Pos</th>
                <th className="text-left px-3 py-2 font-medium">NFL Team</th>
              </tr></thead>
              <tbody>
                {recap.picks.map((pick) => (
                  <tr key={pick.pickNumber} className="border-b hover:bg-accent/50">
                    <td className="px-3 py-2 text-muted-foreground">{pick.pickNumber}</td>
                    <td className="px-3 py-2">{pick.round}</td>
                    <td className="px-3 py-2 font-medium">{pick.entryName}</td>
                    <td className="px-3 py-2">{pick.participantName}</td>
                    <td className="px-3 py-2"><Badge variant="outline" className="text-xs">{pick.position}</Badge></td>
                    <td className="px-3 py-2 text-muted-foreground">{pick.team}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Team Rosters</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {recap.teams.map((team) => (
            <div key={team.id} className="border rounded-md">
              <button
                className="flex items-center justify-between w-full px-4 py-3 hover:bg-accent/50"
                onClick={() => setExpandedTeam(expandedTeam === team.id ? null : team.id)}
              >
                <span className="font-medium text-sm">{team.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{team.picks.length} picks</span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${expandedTeam === team.id ? 'rotate-180' : ''}`} />
                </div>
              </button>
              {expandedTeam === team.id && (
                <div className="px-4 pb-3 space-y-1">
                  {team.picks.map((pick) => (
                    <div key={pick.pickNumber} className="flex items-center gap-3 text-sm py-1">
                      <Badge variant="outline" className="text-[10px] w-8 justify-center">{pick.position}</Badge>
                      <span>{pick.name}</span>
                      <span className="text-muted-foreground">{pick.team}</span>
                      <span className="text-xs text-muted-foreground ml-auto">Rd {pick.round}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><TrendingUp className="h-5 w-5 text-green-600" /> Best Value</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {recap.analysis.bestValue.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span>{p.name} <span className="text-muted-foreground">(Rank {p.ranking}, Pick {p.pickNumber})</span></span>
                <Badge variant="outline" className="text-green-600">+{p.delta}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-lg flex items-center gap-2"><TrendingDown className="h-5 w-5 text-orange-600" /> Biggest Reaches</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {recap.analysis.biggestReaches.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span>{p.name} <span className="text-muted-foreground">(Rank {p.ranking}, Pick {p.pickNumber})</span></span>
                <Badge variant="outline" className="text-orange-600">{p.delta}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
