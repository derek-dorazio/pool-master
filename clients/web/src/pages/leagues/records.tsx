import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Trophy, Flame, Star, Target, TrendingUp, Award, AlertCircle } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { clientPath } from '@poolmaster/shared/api-routes';

interface RecordItem {
  id: string;
  category: string;
  holderName: string;
  value: string;
  season?: string;
}

function getRecordIcon(category: string) {
  const lower = category.toLowerCase();
  if (lower.includes('streak')) return Flame;
  if (lower.includes('draft')) return Star;
  if (lower.includes('accura')) return Target;
  if (lower.includes('score') || lower.includes('season')) return TrendingUp;
  if (lower.includes('win')) return Award;
  return Trophy;
}

function useRecords(leagueId: string) {
  return useQuery({
    queryKey: ['league-records', leagueId],
    queryFn: async (): Promise<RecordItem[]> => {
      const res = await api.get<{ records: RecordItem[] }>(
        clientPath(`/api/v1/leagues/${leagueId}/history/records`),
      );
      return res.records;
    },
  });
}

export function Component() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { data: records = [], isLoading, isError } = useRecords(leagueId!);

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-xl font-semibold mb-2">Failed to load records</h2>
        <p className="text-muted-foreground">Something went wrong. Please try again later.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-muted-foreground">Loading records...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">League Records</h1>
      <p className="text-muted-foreground">
        The all-time record book. Notable achievements across all seasons.
      </p>

      {records.length === 0 ? (
        <p className="text-muted-foreground text-sm">No records yet. Play some contests to earn records!</p>
      ) : (
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
                  <Button variant="ghost" size="sm" className="mt-3 -ml-2 text-xs">
                    View Details
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
