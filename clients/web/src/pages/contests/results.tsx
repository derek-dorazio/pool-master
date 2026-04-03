import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Trophy, ChevronLeft, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useContest } from '@/features/contests/hooks/use-contest';
import { client, getStandings } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import { SelectionType } from '@poolmaster/shared/domain';
import {
  StandingsResponseSchema,
  type StandingEntryDto,
} from '@poolmaster/shared/dto';

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-yellow-100 text-sm font-bold text-yellow-700">1</span>;
  if (rank === 2) return <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gray-200 text-sm font-bold text-gray-700">2</span>;
  if (rank === 3) return <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-700">3</span>;
  return <span className="text-sm font-medium">{rank}</span>;
}

function getSelectionLabel(selectionType: string | undefined) {
  switch (selectionType) {
    case SelectionType.PICK_EM:
      return "Pick'em";
    case SelectionType.BRACKET_PICK_EM:
      return "Bracket Pick'em";
    default:
      return null;
  }
}

function getResultsCopy(selectionType: string | undefined) {
  switch (selectionType) {
    case SelectionType.PICK_EM:
      return {
        pageTitle: "Pick'em Results",
        subtitle: 'Final standings for saved predictions and their persisted scores.',
        standingsTitle: "Pick'em Standings Snapshot",
        entryColumnLabel: 'Prediction',
        leaderLabel: "Pick'em Leader",
        scoreLabel: 'Prediction Score',
        marginLabel: 'Lead Over 2nd Prediction',
      };
    case SelectionType.BRACKET_PICK_EM:
      return {
        pageTitle: "Bracket Pick'em Results",
        subtitle: 'Final standings for saved bracket predictions and their persisted scores.',
        standingsTitle: "Bracket Standings Snapshot",
        entryColumnLabel: 'Bracket',
        leaderLabel: 'Bracket Leader',
        scoreLabel: 'Bracket Score',
        marginLabel: 'Lead Over 2nd Bracket',
      };
    default:
      return {
        pageTitle: 'Contest Results',
        subtitle: 'Based on the latest persisted standings.',
        standingsTitle: 'Standings Snapshot',
        entryColumnLabel: 'Entry',
        leaderLabel: 'Leader',
        scoreLabel: 'Total Score',
        marginLabel: 'Lead Over 2nd',
      };
  }
}

export function Component() {
  const { contestId } = useParams();
  const { data: contest } = useContest(contestId);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['contests', contestId, 'standings'],
    queryFn: async () => {
      const { data, error } = await getStandings({
        client,
        path: { contestId: contestId! },
      });
      if (error) throw error;
      if (!data) {
        throw new Error('Standings response was empty.');
      }
      return StandingsResponseSchema.parse(data);
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return <div className="space-y-6"><div className="h-8 w-64 rounded bg-muted animate-pulse" /></div>;
  }

  if (isError || !data || data.standings.length === 0) {
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
            <h1 className="text-2xl font-bold">Results unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {error instanceof Error ? error.message : 'Final standings are not available yet.'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const standings = data.standings;
  const winner: StandingEntryDto = standings[0];
  const runnerUp: StandingEntryDto | undefined = standings[1];
  const margin = runnerUp ? winner.totalScore - runnerUp.totalScore : null;
  const copy = getResultsCopy(contest?.contest.selectionType);
  const selectionLabel = getSelectionLabel(contest?.contest.selectionType);

  async function handleShare() {
    const shareUrl = window.location.href;
    const shareContext = selectionLabel ? `${selectionLabel} results` : 'contest results';
    const shareTitle = `PoolMaster ${shareContext}: ${winner.entryName}`;
    const shareText = `${winner.entryName} leads the ${shareContext} with ${winner.totalScore} points.`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        });
        return;
      }

      await navigator.clipboard.writeText(shareUrl);
      toast({
        title: 'Link copied',
        description: 'The contest results link is ready to share.',
      });
    } catch (error) {
      toast({
        title: 'Unable to share results',
        description: error instanceof Error ? error.message : 'The results link could not be shared.',
      });
    }
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

      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{contest?.contest.name ?? 'Contest'}</p>
          <h1 className="text-3xl font-bold">{copy.pageTitle}</h1>
          <p className="text-sm text-muted-foreground">
            {copy.subtitle}
            {selectionLabel ? ` ${selectionLabel} mode.` : ''}
          </p>
        </div>
        <Button variant="outline" onClick={() => void handleShare()}>
          <Share2 className="mr-2 h-4 w-4" />
          Share Results
        </Button>
      </div>

      <Card className="border-yellow-200 bg-gradient-to-br from-yellow-50 to-amber-50">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100">
            <Trophy className="h-8 w-8 text-yellow-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-yellow-700">{copy.leaderLabel}</p>
            <h2 className="text-2xl font-bold">{winner.entryName}</h2>
            <p className="text-muted-foreground">{winner.ownerDisplayName}</p>
          </div>
          <div className="flex items-center gap-6">
            <div>
              <p className="text-3xl font-bold">{winner.totalScore}</p>
              <p className="text-xs text-muted-foreground">{copy.scoreLabel}</p>
            </div>
            {runnerUp ? (
              <div>
                <p className="text-3xl font-bold">+{margin}</p>
                <p className="text-xs text-muted-foreground">{copy.marginLabel}</p>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{copy.standingsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">Rank</th>
                  <th className="px-4 py-2 text-left font-medium">{copy.entryColumnLabel}</th>
                  <th className="px-4 py-2 text-left font-medium">Owner</th>
                  <th className="px-4 py-2 text-right font-medium">{copy.scoreLabel}</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((entry) => (
                  <tr key={entry.entryId} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <RankBadge rank={entry.rank} />
                    </td>
                    <td className="px-4 py-3 font-medium">{entry.entryName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{entry.ownerDisplayName}</td>
                    <td className="px-4 py-3 text-right font-mono font-medium">{entry.totalScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
