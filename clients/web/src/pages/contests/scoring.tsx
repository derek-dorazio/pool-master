import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useContest } from '@/features/contests/hooks/use-contest';

interface ParticipantScoring {
  id: string;
  name: string;
  tier: string;
  score: number;
  pctOfTotal: number;
  stats: Array<{ label: string; detail: string; points: number }>;
}

interface ScoringRule {
  stat: string;
  points: string;
  condition: string;
}

const mockEntries = [
  { id: 'entry-me', name: 'My Entry (You)' },
  { id: 'entry-1', name: 'Eagle Eye (Sarah K.)' },
  { id: 'entry-2', name: 'Birdie Brigade (Jake M.)' },
  { id: 'entry-4', name: 'Par for Course (Lisa R.)' },
];

const mockParticipants: ParticipantScoring[] = [
  {
    id: 'p1',
    name: 'Scottie Scheffler',
    tier: 'Tier 1',
    score: 82,
    pctOfTotal: 29.9,
    stats: [
      { label: 'Eagles', detail: '2 x 8pts', points: 16 },
      { label: 'Birdies', detail: '12 x 3pts', points: 36 },
      { label: 'Pars', detail: '40 x 0.5pts', points: 20 },
      { label: 'Top 10 Finish', detail: '1 x 5pts', points: 5 },
      { label: 'Win Bonus', detail: '1 x 10pts', points: 10 },
      { label: 'Bogeys', detail: '10 x -0.5pts', points: -5 },
    ],
  },
  {
    id: 'p2',
    name: 'Rory McIlroy',
    tier: 'Tier 2',
    score: 71,
    pctOfTotal: 25.9,
    stats: [
      { label: 'Eagles', detail: '1 x 8pts', points: 8 },
      { label: 'Birdies', detail: '14 x 3pts', points: 42 },
      { label: 'Pars', detail: '38 x 0.5pts', points: 19 },
      { label: 'Top 10 Finish', detail: '1 x 5pts', points: 5 },
      { label: 'Bogeys', detail: '6 x -0.5pts', points: -3 },
    ],
  },
  {
    id: 'p3',
    name: 'Collin Morikawa',
    tier: 'Tier 3',
    score: 68,
    pctOfTotal: 24.8,
    stats: [
      { label: 'Eagles', detail: '1 x 8pts', points: 8 },
      { label: 'Birdies', detail: '10 x 3pts', points: 30 },
      { label: 'Pars', detail: '44 x 0.5pts', points: 22 },
      { label: 'Top 10 Finish', detail: '1 x 5pts', points: 5 },
      { label: 'Bogeys', detail: '4 x -0.5pts', points: -2 },
      { label: 'Win Bonus', detail: '1 x 10pts', points: 5 },
    ],
  },
  {
    id: 'p4',
    name: 'Tommy Fleetwood',
    tier: 'Tier 4',
    score: 53,
    pctOfTotal: 19.3,
    stats: [
      { label: 'Birdies', detail: '8 x 3pts', points: 24 },
      { label: 'Pars', detail: '46 x 0.5pts', points: 23 },
      { label: 'Top 10 Finish', detail: '1 x 5pts', points: 5 },
      { label: 'Bogeys', detail: '2 x -0.5pts', points: -1 },
      { label: 'Double Bogey+', detail: '1 x -2pts', points: 2 },
    ],
  },
];

const scoringRules: ScoringRule[] = [
  { stat: 'Eagle', points: '+8', condition: 'Per hole' },
  { stat: 'Birdie', points: '+3', condition: 'Per hole' },
  { stat: 'Par', points: '+0.5', condition: 'Per hole' },
  { stat: 'Bogey', points: '-0.5', condition: 'Per hole' },
  { stat: 'Double Bogey+', points: '-2', condition: 'Per hole' },
  { stat: 'Top 10 Finish', points: '+5', condition: 'Bonus' },
  { stat: 'Win', points: '+10', condition: 'Bonus' },
  { stat: 'Missed Cut', points: '-5', condition: 'Penalty' },
];

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
  const [selectedEntry, setSelectedEntry] = useState('entry-me');
  const [rulesExpanded, setRulesExpanded] = useState(false);

  const totalScore = mockParticipants.reduce((sum, p) => sum + p.score, 0);

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
          {mockEntries.map((entry) => (
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
              {mockParticipants.map((p) => (
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
