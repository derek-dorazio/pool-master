import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Trophy, Calendar } from 'lucide-react';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ContestResult {
  id: string;
  name: string;
  winner: string;
  score: string;
  date: string;
}

interface Season {
  id: string;
  name: string;
  contestResults: ContestResult[];
}

const mockSeasons: Season[] = [
  {
    id: 's1',
    name: '2025-26 Season',
    contestResults: [
      {
        id: 'cr1',
        name: 'Week 14 Pick\'em',
        winner: 'Sarah Kim',
        score: '14/16 correct',
        date: 'Dec 8, 2025',
      },
      {
        id: 'cr2',
        name: 'Survivor Pool 2025',
        winner: 'Dan Miller',
        score: 'Survived 13 weeks',
        date: 'Nov 30, 2025',
      },
      {
        id: 'cr3',
        name: 'Fantasy Draft League',
        winner: 'Chris Park',
        score: '1,247 total points',
        date: 'Jan 15, 2026',
      },
    ],
  },
  {
    id: 's2',
    name: '2024-25 Season',
    contestResults: [
      {
        id: 'cr4',
        name: 'Season-Long Pick\'em',
        winner: 'Mike Johnson',
        score: '178/256 correct',
        date: 'Feb 10, 2025',
      },
      {
        id: 'cr5',
        name: 'Playoff Bracket Challenge',
        winner: 'Amy Lee',
        score: '8/11 correct',
        date: 'Feb 9, 2025',
      },
      {
        id: 'cr6',
        name: 'Survivor Pool 2024',
        winner: 'Tom Brown',
        score: 'Survived 11 weeks',
        date: 'Nov 24, 2024',
      },
    ],
  },
  {
    id: 's3',
    name: '2023-24 Season',
    contestResults: [
      {
        id: 'cr7',
        name: 'Season-Long Pick\'em',
        winner: 'Sarah Kim',
        score: '182/256 correct',
        date: 'Feb 11, 2024',
      },
      {
        id: 'cr8',
        name: 'Survivor Pool 2023',
        winner: 'Dan Miller',
        score: 'Survived 15 weeks',
        date: 'Dec 17, 2023',
      },
    ],
  },
];

function useHistory(leagueId: string) {
  return useQuery({
    queryKey: ['league-history', leagueId],
    queryFn: async () => mockSeasons,
    initialData: mockSeasons,
  });
}

function SeasonAccordion({ season }: { season: Season }) {
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
                    <div className="text-xs text-muted-foreground">
                      {result.date}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium">{result.winner}</div>
                  <Badge variant="secondary" className="text-xs">
                    {result.score}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export function Component() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { data: seasons = [] } = useHistory(leagueId!);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">League History</h1>
      <p className="text-muted-foreground">
        Past seasons and contest results. Expand a season to see the details.
      </p>

      <div className="space-y-3">
        {seasons.map((season) => (
          <SeasonAccordion key={season.id} season={season} />
        ))}
      </div>
    </div>
  );
}
