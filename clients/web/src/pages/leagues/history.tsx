import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Trophy, Calendar, AlertCircle } from 'lucide-react';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { client, getSeasonSummaries } from '@/lib/api';

interface ContestResult {
  id: string;
  contestName: string;
  winnerName: string;
  score: string;
  date: string;
}

interface SeasonSummary {
  id: string;
  season: string;
  year: number;
  contestCount: number;
  results?: ContestResult[];
}

function useHistory(leagueId: string) {
  return useQuery({
    queryKey: ['league-history', leagueId],
    queryFn: async (): Promise<SeasonSummary[]> => {
      const { data, error } = await getSeasonSummaries({ client, path: { id: leagueId } });
      if (error) throw error;
      return (data as any).seasons ?? [];
    },
  });
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
                      <div className="text-xs text-muted-foreground">
                        {result.date}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">{result.winnerName}</div>
                    <Badge variant="secondary" className="text-xs">
                      {result.score}
                    </Badge>
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

export function Component() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { data: seasons = [], isLoading, isError } = useHistory(leagueId!);

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-xl font-semibold mb-2">Failed to load history</h2>
        <p className="text-muted-foreground">Something went wrong. Please try again later.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-muted-foreground">Loading history...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">League History</h1>
      <p className="text-muted-foreground">
        Past seasons and contest results. Expand a season to see the details.
      </p>

      {seasons.length === 0 ? (
        <p className="text-muted-foreground text-sm">No seasons completed yet.</p>
      ) : (
        <div className="space-y-3">
          {seasons.map((season) => (
            <SeasonAccordion key={season.id} season={season} />
          ))}
        </div>
      )}
    </div>
  );
}
