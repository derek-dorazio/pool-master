import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useContest } from '@/features/contests/hooks/use-contest';
import { useStandings } from '@/features/contests/hooks/use-standings';
import { client } from '@/lib/api';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { SelectionType } from '@poolmaster/shared/domain';
import {
  EntryScoreDetailResponseSchema,
  type StandingsResponse,
} from '@poolmaster/shared/dto';

function getScoringCopy(selectionType: string | undefined) {
  switch (selectionType) {
    case SelectionType.PICK_EM:
      return {
        pageTitle: "Pick'em Score Breakdown",
        subtitle: 'Timeline of persisted scores for saved predictions.',
        timelineTitle: 'Prediction Timeline',
        contributionTitle: 'Selection Contributions',
        entryLabel: "Pick'em Entry",
      };
    case SelectionType.BRACKET_PICK_EM:
      return {
        pageTitle: 'Bracket Score Breakdown',
        subtitle: 'Timeline of persisted scores for saved bracket predictions.',
        timelineTitle: 'Bracket Timeline',
        contributionTitle: 'Prediction Contributions',
        entryLabel: 'Bracket Entry',
      };
    default:
      return {
        pageTitle: 'Score Breakdown',
        subtitle: 'Timeline of persisted scores for this contest.',
        timelineTitle: 'Entry Timeline',
        contributionTitle: 'Participant Contributions',
        entryLabel: 'Entry',
      };
  }
}

export function Component() {
  const { contestId } = useParams();
  const { data: contest } = useContest(contestId);
  const { data: standings, isLoading: standingsLoading, isError: standingsError, error: standingsQueryError } =
    useStandings(contestId) as {
      data: StandingsResponse | undefined;
      isLoading: boolean;
      isError: boolean;
      error: unknown;
    };
  const [selectedEntry, setSelectedEntry] = useState('');

  useEffect(() => {
    if (!selectedEntry && standings?.standings[0]?.entryId) {
      setSelectedEntry(standings.standings[0].entryId);
    }
  }, [selectedEntry, standings]);

  const { data: scoreDetail, isLoading: scoreLoading, isError: scoreError, error: scoreQueryError } = useQuery({
    queryKey: ['contests', contestId, 'entry-score', selectedEntry],
    queryFn: async () => {
      const { data, error } = await client.get({
        url: API_ROUTES.scoring.entry(contestId!, selectedEntry),
      });
      if (error) throw error;
      return EntryScoreDetailResponseSchema.parse(data);
    },
    enabled: !!contestId && !!selectedEntry,
    staleTime: 2 * 60 * 1000,
  });

  if (standingsLoading) {
    return <div className="space-y-6"><div className="h-8 w-64 rounded bg-muted animate-pulse" /></div>;
  }

  if (standingsError || !standings) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/contests/${contestId}`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to Contest
          </Link>
        </Button>
        <Card>
          <CardContent className="py-10 text-center">
            <h1 className="text-2xl font-bold">Score breakdown unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {standingsQueryError instanceof Error ? standingsQueryError.message : 'Standings are unavailable for this contest.'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const copy = getScoringCopy(contest?.contest.selectionType);

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
        <p className="text-sm text-muted-foreground">{contest?.contest.name ?? 'Contest'}</p>
        <h1 className="text-3xl font-bold">{copy.pageTitle}</h1>
        <p className="text-sm text-muted-foreground">
          {copy.subtitle}
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="entry-select">{`Select ${copy.entryLabel}`}</label>
        <select
          id="entry-select"
          value={selectedEntry}
          onChange={(event) => setSelectedEntry(event.target.value)}
          className="flex h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {standings.standings.map((entry) => (
            <option key={entry.entryId} value={entry.entryId}>
              {entry.entryName} ({entry.ownerDisplayName})
            </option>
          ))}
        </select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{copy.timelineTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {scoreLoading && <p className="text-sm text-muted-foreground">Loading score details...</p>}

          {scoreError && (
            <p className="text-sm text-muted-foreground">
              {scoreQueryError instanceof Error ? scoreQueryError.message : 'Score detail is unavailable for this entry.'}
            </p>
          )}

          {!scoreLoading && !scoreError && scoreDetail && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                <div>
                  <p className="text-sm text-muted-foreground">Current Total</p>
                  <p className="text-2xl font-bold">{scoreDetail.totalScore}</p>
                </div>
                <div className="text-right text-sm text-muted-foreground">
                  <p>{scoreDetail.timeline.length} scoring events</p>
                </div>
              </div>

              {scoreDetail.timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No score events have been recorded for this entry yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-4 py-2 text-left font-medium">Timestamp</th>
                        <th className="px-4 py-2 text-right font-medium">Points Earned</th>
                        <th className="px-4 py-2 text-right font-medium">Running Total</th>
                        <th className="px-4 py-2 text-left font-medium">{copy.contributionTitle}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scoreDetail.timeline.map((event, index) => (
                        <tr key={`${event.eventTimestamp}-${index}`} className="border-b last:border-0">
                          <td className="px-4 py-3 text-muted-foreground">
                            {new Date(event.eventTimestamp).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-medium">
                            {event.pointsEarned >= 0 ? '+' : ''}{event.pointsEarned}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">{event.runningTotal}</td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {event.participantBreakdowns.map((breakdown) => (
                              <div key={breakdown.participantId}>
                                <div>
                                  {breakdown.participantName ?? breakdown.participantId}: {breakdown.finalScore}
                                </div>
                                {breakdown.contextLabel && (
                                  <div className="text-xs text-muted-foreground">
                                    {breakdown.contextLabel}
                                  </div>
                                )}
                              </div>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
