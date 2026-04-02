import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useContest } from '@/features/contests/hooks/use-contest';
import { client, getStandings } from '@/lib/api';

interface ParticipantScoring {
  id: string;
  name: string;
  tier: string;
  score: number;
  pctOfTotal: number;
  stats: Array<{ label: string; detail: string; points: number }>;
}

interface ScoringEntry {
  id: string;
  name: string;
}

interface ScoringRule {
  stat: string;
  points: string;
  condition: string;
}

interface ScoringResponse {
  entries: ScoringEntry[];
  participants: ParticipantScoring[];
  rules: ScoringRule[];
}


function ParticipantRow({ participant }: { participant: ParticipantScoring }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="cursor-pointer border-b transition-colors hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="font-medium">{participant.name}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-muted-foreground">{participant.tier}</td>
        <td className="px-4 py-3 text-right font-mono font-medium">{participant.score}</td>
        <td className="px-4 py-3 text-right text-muted-foreground">{participant.pctOfTotal.toFixed(1)}%</td>
      </tr>
      {expanded && (
        <tr className="border-b">
          <td colSpan={4} className="bg-muted/30 px-4 py-3">
            <div className="ml-6 space-y-1">
              {participant.stats.map((stat, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {stat.label}{' '}
                    <span className="font-mono text-xs">({stat.detail})</span>
                  </span>
                  <span
                    className={cn(
                      'font-mono font-medium',
                      stat.points >= 0 ? 'text-green-600' : 'text-red-600'
                    )}
                  >
                    {stat.points >= 0 ? '+' : ''}{stat.points}
                  </span>
                </div>
              ))}
              <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm font-medium">
                <span>Total</span>
                <span className="font-mono">{participant.score} pts</span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function Component() {
  const { contestId } = useParams();
  const { data: contest } = useContest(contestId);
  const [selectedEntry, setSelectedEntry] = useState('');
  const [rulesExpanded, setRulesExpanded] = useState(false);

  const { data: scoring, isLoading } = useQuery({
    queryKey: ['contests', contestId, 'scoring', selectedEntry],
    queryFn: async () => {
      const { data, error } = await getStandings({
        client,
        path: { contestId: contestId! },
        query: selectedEntry ? { entryId: selectedEntry } : undefined,
      });
      if (error) throw error;
      return data as unknown as ScoringResponse;
    },
    staleTime: 2 * 60 * 1000,
  });

  const entries = scoring?.entries ?? [];
  const participants = scoring?.participants ?? [];
  const scoringRules = scoring?.rules ?? [];
  const totalScore = participants.reduce((sum, p) => sum + p.score, 0);

  if (isLoading) {
    return <div className="space-y-6"><div className="h-8 w-64 rounded bg-muted animate-pulse" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/contests/${contestId}`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to Contest
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-3xl font-bold">Score Breakdown</h1>
        <p className="text-sm text-muted-foreground">
          {contest?.name ?? 'Contest'} &middot; DFS Points scoring
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="entry-select">Select Entry</label>
        <select
          id="entry-select"
          value={selectedEntry}
          onChange={(e) => setSelectedEntry(e.target.value)}
          className="flex h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {entries.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.name}</option>
          ))}
        </select>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Entry Scorecard</CardTitle>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Total Score</p>
              <p className="text-2xl font-bold">{totalScore}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-2 text-left font-medium">Participant</th>
                <th className="px-4 py-2 text-left font-medium">Position</th>
                <th className="px-4 py-2 text-right font-medium">Score</th>
                <th className="px-4 py-2 text-right font-medium">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => (
                <ParticipantRow key={p.id} participant={p} />
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setRulesExpanded(!rulesExpanded)}
          >
            <CardTitle>Scoring Rules Reference</CardTitle>
            {rulesExpanded ? (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            )}
          </button>
        </CardHeader>
        {rulesExpanded && (
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">Stat</th>
                  <th className="px-4 py-2 text-left font-medium">Points</th>
                  <th className="px-4 py-2 text-left font-medium">Condition</th>
                </tr>
              </thead>
              <tbody>
                {scoringRules.map((rule, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-4 py-2">{rule.stat}</td>
                    <td className="px-4 py-2 font-mono">{rule.points}</td>
                    <td className="px-4 py-2 text-muted-foreground">{rule.condition}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
