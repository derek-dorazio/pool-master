import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useContest } from '@/features/contests/hooks/use-contest';
import { useStandings } from '@/features/contests/hooks/use-standings';
import { SelectionType } from '@poolmaster/shared/domain';
import {
  EntryScoreDetailResponseSchema,
  type EntryScoreDetailResponse,
  type StandingEntryDto,
  type StandingsResponse,
} from '@poolmaster/shared/dto';
import { API_ROUTES } from '@poolmaster/shared/api-routes';

interface ParticipantContribution {
  participantId: string;
  participantName: string | null;
  totalScore: number;
}

interface ComparisonEntry {
  id: string;
  entryName: string;
  ownerName: string;
  totalScore: number;
  participants: ParticipantContribution[];
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return fallback;
}

function getComparisonCopy(selectionType: string | undefined) {
  switch (selectionType) {
    case SelectionType.PICK_EM:
      return {
        subtitle: "Compare two contest entries using persisted standings and pick'em scoring timelines",
        contributionLabel: 'Selection contribution',
      };
    case SelectionType.BRACKET_PICK_EM:
      return {
        subtitle: 'Compare two contest entries using persisted standings and bracket scoring timelines',
        contributionLabel: 'Prediction contribution',
      };
    default:
      return {
        subtitle: 'Compare two contest entries using persisted standings and score timelines',
        contributionLabel: 'Participant contribution',
      };
  }
}

function useEntryScore(contestId: string | undefined, entryId: string) {
  return useQuery({
    queryKey: ['contests', contestId, 'head-to-head', entryId],
    queryFn: async (): Promise<EntryScoreDetailResponse> => {
      const { data, error } = await client.get({
        url: API_ROUTES.scoring.entry(contestId!, entryId),
      });
      if (error) throw error;
      return EntryScoreDetailResponseSchema.parse(data);
    },
    enabled: !!contestId && !!entryId,
  });
}

function aggregateParticipantContributions(
  entry: StandingEntryDto,
  scoreDetail: EntryScoreDetailResponse | undefined,
): ComparisonEntry {
  const contributionByParticipant = new Map<string, ParticipantContribution>();

  for (const event of scoreDetail?.timeline ?? []) {
    for (const breakdown of event.participantBreakdowns) {
      const existing = contributionByParticipant.get(breakdown.participantId);
      contributionByParticipant.set(breakdown.participantId, {
        participantId: breakdown.participantId,
        participantName: breakdown.participantName ?? existing?.participantName ?? null,
        totalScore: (existing?.totalScore ?? 0) + breakdown.finalScore,
      });
    }
  }

  const participants = [...contributionByParticipant.entries()]
    .map(([, contribution]) => contribution)
    .sort((a, b) => b.totalScore - a.totalScore);

  return {
    id: entry.entryId,
    entryName: entry.entryName,
    ownerName: entry.ownerDisplayName,
    totalScore: entry.totalScore,
    participants,
  };
}

function EntryColumn({
  entry,
  isWinning,
  contributionLabel,
}: {
  entry: ComparisonEntry;
  isWinning: boolean;
  contributionLabel: string;
}) {
  return (
    <div className="flex-1 space-y-4">
      <div className={cn('rounded-lg border p-4', isWinning && 'border-primary bg-primary/5')}>
        <p className="font-semibold">{entry.entryName}</p>
        <p className="text-sm text-muted-foreground">{entry.ownerName}</p>
        <p className="mt-2 text-2xl font-bold">{entry.totalScore}</p>
        <p className="text-xs text-muted-foreground">Total Score</p>
      </div>
      <div className="space-y-2">
        {entry.participants.length === 0 ? (
          <div className="rounded-lg bg-muted/50 px-3 py-3 text-sm text-muted-foreground">
            No persisted scoring contributions are available yet for this entry.
          </div>
        ) : (
          entry.participants.map((participant) => (
            <div key={participant.participantId} className="rounded-lg bg-muted/50 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{participant.participantName ?? participant.participantId}</span>
                <span className="text-sm font-mono font-medium">{participant.totalScore}</span>
              </div>
              <p className="text-xs text-muted-foreground">{contributionLabel}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function Component() {
  const { contestId } = useParams();
  const { data: contest } = useContest(contestId);
  const {
    data: standings,
    isLoading,
    isError,
    error,
  } = useStandings(contestId) as {
    data: StandingsResponse | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');

  useEffect(() => {
    if ((standings?.standings.length ?? 0) >= 2) {
      setLeftId((current) => current || standings!.standings[0].entryId);
      setRightId((current) => current || standings!.standings[1].entryId);
    }
  }, [standings]);

  const leftScore = useEntryScore(contestId, leftId);
  const rightScore = useEntryScore(contestId, rightId);

  const entryMap = useMemo(
    () => new Map((standings?.standings ?? []).map((entry) => [entry.entryId, entry])),
    [standings],
  );
  const entryOptions = (standings?.standings ?? []).map((entry) => ({
    id: entry.entryId,
    label: `${entry.entryName} (${entry.ownerDisplayName})`,
  }));
  const leftStanding = entryMap.get(leftId);
  const rightStanding = entryMap.get(rightId);
  const leftEntry = leftStanding ? aggregateParticipantContributions(leftStanding, leftScore.data) : null;
  const rightEntry = rightStanding ? aggregateParticipantContributions(rightStanding, rightScore.data) : null;
  const diff = leftEntry && rightEntry ? leftEntry.totalScore - rightEntry.totalScore : 0;
  const copy = getComparisonCopy(contest?.contest.selectionType);

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
          {copy.subtitle}
        </p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">Loading comparison...</p>
          </CardContent>
        </Card>
      ) : isError || !standings ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">
              {getErrorMessage(error, 'Standings are unavailable for this contest.')}
            </p>
          </CardContent>
        </Card>
      ) : standings.standings.length < 2 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">
              At least two entries are required before a head-to-head comparison is available.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="left-entry">Entry 1</label>
              <select
                id="left-entry"
                value={leftId}
                onChange={(event) => setLeftId(event.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {entryOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="right-entry">Entry 2</label>
              <select
                id="right-entry"
                value={rightId}
                onChange={(event) => setRightId(event.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {entryOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>

          {(leftScore.isLoading || rightScore.isLoading) && (
            <Card>
              <CardContent className="py-6 text-center">
                <p className="text-sm text-muted-foreground">Loading score timelines...</p>
              </CardContent>
            </Card>
          )}

          {(leftScore.isError || rightScore.isError) && (
            <Card>
              <CardContent className="py-6 text-center">
                <p className="text-sm text-muted-foreground">
                  {getErrorMessage(leftScore.error ?? rightScore.error, 'Score timeline data is unavailable for one or both entries.')}
                </p>
              </CardContent>
            </Card>
          )}

          {leftEntry && rightEntry && !leftScore.isError && !rightScore.isError && (
            <>
              <div className="flex items-center justify-center gap-2 text-center">
                <span className="text-sm text-muted-foreground">Score differential:</span>
                <span
                  className={cn(
                    'text-lg font-bold',
                    diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-muted-foreground',
                  )}
                >
                  {diff > 0 ? '+' : ''}{diff}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <EntryColumn
                  entry={leftEntry}
                  isWinning={leftEntry.totalScore >= rightEntry.totalScore}
                  contributionLabel={copy.contributionLabel}
                />
                <EntryColumn
                  entry={rightEntry}
                  isWinning={rightEntry.totalScore >= leftEntry.totalScore}
                  contributionLabel={copy.contributionLabel}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
