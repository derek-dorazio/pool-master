import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

interface H2HParticipant {
  name: string;
  tier: string;
  score: number;
}

interface H2HEntry {
  id: string;
  entryName: string;
  ownerName: string;
  totalScore: number;
  participants: H2HParticipant[];
}

const mockEntryOptions = [
  { id: 'entry-me', label: 'My Entry (You)' },
  { id: 'entry-1', label: 'Eagle Eye (Sarah K.)' },
  { id: 'entry-2', label: 'Birdie Brigade (Jake M.)' },
  { id: 'entry-4', label: 'Par for Course (Lisa R.)' },
  { id: 'entry-5', label: 'Bogey Squad (Tom W.)' },
];

const mockEntryData: Record<string, H2HEntry> = {
  'entry-me': {
    id: 'entry-me',
    entryName: 'My Entry',
    ownerName: 'You',
    totalScore: 274,
    participants: [
      { name: 'Scottie Scheffler', tier: 'Tier 1', score: 82 },
      { name: 'Rory McIlroy', tier: 'Tier 2', score: 71 },
      { name: 'Collin Morikawa', tier: 'Tier 3', score: 68 },
      { name: 'Tommy Fleetwood', tier: 'Tier 4', score: 53 },
    ],
  },
  'entry-1': {
    id: 'entry-1',
    entryName: 'Eagle Eye',
    ownerName: 'Sarah K.',
    totalScore: 298,
    participants: [
      { name: 'Scottie Scheffler', tier: 'Tier 1', score: 82 },
      { name: 'Jon Rahm', tier: 'Tier 2', score: 78 },
      { name: 'Viktor Hovland', tier: 'Tier 3', score: 74 },
      { name: 'Shane Lowry', tier: 'Tier 4', score: 64 },
    ],
  },
  'entry-2': {
    id: 'entry-2',
    entryName: 'Birdie Brigade',
    ownerName: 'Jake M.',
    totalScore: 285,
    participants: [
      { name: 'Xander Schauffele', tier: 'Tier 1', score: 79 },
      { name: 'Rory McIlroy', tier: 'Tier 2', score: 71 },
      { name: 'Ludvig Aberg', tier: 'Tier 3', score: 72 },
      { name: 'Min Woo Lee', tier: 'Tier 4', score: 63 },
    ],
  },
  'entry-4': {
    id: 'entry-4',
    entryName: 'Par for Course',
    ownerName: 'Lisa R.',
    totalScore: 261,
    participants: [
      { name: 'Bryson DeChambeau', tier: 'Tier 1', score: 76 },
      { name: 'Brooks Koepka', tier: 'Tier 2', score: 69 },
      { name: 'Collin Morikawa', tier: 'Tier 3', score: 68 },
      { name: 'Hideki Matsuyama', tier: 'Tier 4', score: 48 },
    ],
  },
  'entry-5': {
    id: 'entry-5',
    entryName: 'Bogey Squad',
    ownerName: 'Tom W.',
    totalScore: 255,
    participants: [
      { name: 'Jon Rahm', tier: 'Tier 1', score: 78 },
      { name: 'Patrick Cantlay', tier: 'Tier 2', score: 65 },
      { name: 'Russell Henley', tier: 'Tier 3', score: 60 },
      { name: 'Tommy Fleetwood', tier: 'Tier 4', score: 52 },
    ],
  },
};

function EntryColumn({ entry, isWinning }: { entry: H2HEntry; isWinning: boolean }) {
  return (
    <div className="flex-1 space-y-4">
      <div className={cn('rounded-lg border p-4', isWinning && 'border-primary bg-primary/5')}>
        <p className="font-semibold">{entry.entryName}</p>
        <p className="text-sm text-muted-foreground">{entry.ownerName}</p>
        <p className="mt-2 text-2xl font-bold">{entry.totalScore}</p>
        <p className="text-xs text-muted-foreground">Total Score</p>
      </div>
      <div className="space-y-2">
        {entry.participants.map((p, i) => (
          <div key={i} className="rounded-lg bg-muted/50 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{p.name}</span>
              <span className="text-sm font-mono font-medium">{p.score}</span>
            </div>
            <p className="text-xs text-muted-foreground">{p.tier}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Component() {
  const { contestId } = useParams();
  const [leftId, setLeftId] = useState('entry-me');
  const [rightId, setRightId] = useState('entry-1');

  const leftEntry = mockEntryData[leftId];
  const rightEntry = mockEntryData[rightId];
  const diff = leftEntry && rightEntry ? leftEntry.totalScore - rightEntry.totalScore : 0;

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
        <h1 className="text-3xl font-bold">Head-to-Head</h1>
        <p className="text-sm text-muted-foreground">
          Masters 2026 Pool &middot; Compare two entries
        </p>
      </div>

      <Card>
        <CardContent className="flex items-center justify-center gap-4 p-4 text-center">
          <div>
            <span className="text-sm font-medium text-green-600">3 wins</span>
          </div>
          <Separator orientation="vertical" className="h-6" />
          <div>
            <span className="text-sm font-medium text-red-600">1 loss</span>
          </div>
          <Separator orientation="vertical" className="h-6" />
          <div>
            <span className="text-sm font-medium text-muted-foreground">0 ties</span>
          </div>
          <span className="text-xs text-muted-foreground">across 4 shared contests</span>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="left-entry">Entry 1</label>
          <select
            id="left-entry"
            value={leftId}
            onChange={(e) => setLeftId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {mockEntryOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="right-entry">Entry 2</label>
          <select
            id="right-entry"
            value={rightId}
            onChange={(e) => setRightId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {mockEntryOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {leftEntry && rightEntry && (
        <>
          <div className="flex items-center justify-center gap-2 text-center">
            <span className="text-sm text-muted-foreground">Score differential:</span>
            <span
              className={cn(
                'text-lg font-bold',
                diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-muted-foreground'
              )}
            >
              {diff > 0 ? '+' : ''}{diff}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <EntryColumn
              entry={leftEntry}
              isWinning={leftEntry.totalScore >= rightEntry.totalScore}
            />
            <EntryColumn
              entry={rightEntry}
              isWinning={rightEntry.totalScore >= leftEntry.totalScore}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Score Differential Chart
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex h-40 items-center justify-center rounded-lg bg-muted/50">
                <p className="text-sm text-muted-foreground">Chart coming soon</p>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
