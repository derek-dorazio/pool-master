import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Trophy,
  RefreshCw,
  AlertTriangle,
  XCircle,
  RotateCcw,
  Calculator,
  DollarSign,
  Download,
  CheckCircle,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmDialog, useConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  client,
  adminForceCloseContest,
  adminReopenContest,
  adminRecalculateStandings,
  adminRecalculatePayouts,
  adminReIngestScoring,
  adminOverrideScore,
} from '@/lib/api';
import { useContestDetail } from '@/hooks/use-contests-api';

function statusColor(status: string) {
  switch (status.toLowerCase()) {
    case 'open': return 'bg-blue-100 text-blue-800';
    case 'draft':
    case 'drafting': return 'bg-yellow-100 text-yellow-800';
    case 'active': return 'bg-green-100 text-green-800';
    case 'completed': return 'bg-gray-100 text-gray-800';
    case 'cancelled': return 'bg-red-100 text-red-800';
    default: return 'bg-gray-100 text-gray-800';
  }
}

function formatDate(iso?: string | null): string {
  if (!iso) return 'Unavailable';
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function contestTypeLabel(contestType: string): string {
  return contestType === 'SINGLE_EVENT' ? 'Single Event' : 'Season Long';
}

export function Component() {
  const { contestId } = useParams<{ contestId: string }>();
  const queryClient = useQueryClient();
  const { data: contest } = useContestDetail(contestId ?? '');
  const [recalcResult, setRecalcResult] = useState<string | null>(null);
  const dialog = useConfirmDialog();

  if (!contest) return null;

  async function promptReason(action: string): Promise<string | null> {
    const reason = window.prompt(`Reason for ${action}:`);
    if (!reason) return null;
    const confirmed = await dialog.confirm(
      'Confirm Action',
      `Are you sure you want to ${action}?`,
      { confirmLabel: 'Confirm', variant: 'destructive' },
    );
    return confirmed ? reason : null;
  }

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/contests" className="hover:text-foreground">Contests</Link>
        <span>/</span>
        <span>{contest.tenantName}</span>
        <span>/</span>
        <span>{contest.leagueName}</span>
        <span>/</span>
        <span className="text-foreground">{contest.name}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Trophy className="h-6 w-6" />
            <h1 className="text-2xl font-bold">{contest.name}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-purple-100 text-purple-800">{contest.sport}</Badge>
            <Badge variant="outline">{contestTypeLabel(contest.contestType)}</Badge>
            <Badge variant="outline">{contest.selectionType}</Badge>
            <Badge className={cn(statusColor(contest.status))}>{contest.status}</Badge>
          </div>
        </div>
      </div>

      <Tabs defaultValue="standings">
        <TabsList>
          <TabsTrigger value="standings">Standings</TabsTrigger>
          <TabsTrigger value="scoring">Scoring Data</TabsTrigger>
          <TabsTrigger value="draft">Draft</TabsTrigger>
          <TabsTrigger value="overrides">Overrides</TabsTrigger>
          <TabsTrigger value="actions">Admin Actions</TabsTrigger>
        </TabsList>

        <TabsContent value="standings">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Current Standings</CardTitle>
              <CardDescription>{contest.standings.length} entries</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">Rank</th>
                    <th className="px-4 py-3 text-left font-medium">Entry Name</th>
                    <th className="px-4 py-3 text-left font-medium">Owner Email</th>
                    <th className="px-4 py-3 text-right font-medium">Total Score</th>
                  </tr>
                </thead>
                <tbody>
                  {contest.standings.map((entry) => (
                    <tr key={entry.entryId} className="border-b">
                      <td className="px-4 py-3 font-medium">#{entry.rank}</td>
                      <td className="px-4 py-3">{entry.entryName}</td>
                      <td className="px-4 py-3 text-muted-foreground">{entry.ownerEmail}</td>
                      <td className="px-4 py-3 text-right font-mono font-medium">{entry.totalScore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scoring">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Scoring Freshness</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  {contest.scoringFreshness.lastStatEvent ? (
                    contest.scoringFreshness.isStale ? (
                      <>
                        <AlertTriangle className="h-5 w-5 text-red-600" />
                        <span className="text-red-700 font-medium">
                          STALE by {contest.scoringFreshness.staleMinutes} minutes
                        </span>
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-5 w-5 text-green-600" />
                        <span className="text-green-700 font-medium">
                          Last stat event: {formatDate(contest.scoringFreshness.lastStatEvent)}
                        </span>
                      </>
                    )
                  ) : (
                    <>
                      <AlertTriangle className="h-5 w-5 text-red-600" />
                      <span className="text-red-700 font-medium">
                        No stat events have been recorded yet.
                      </span>
                    </>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {contest.statEventCount.toLocaleString()} stat events processed, {contest.correctionsApplied} corrections applied
                </p>
                <Button
                  variant="outline"
                  onClick={async () => {
                    const eventId = window.prompt('Event ID to re-ingest:');
                    if (!eventId) return;
                  const confirmed = await dialog.confirm(
                      'Re-ingest Scoring Data',
                      `Re-ingest scoring data for event ${eventId}?`,
                    );
                    if (confirmed && contestId) {
                      await adminReIngestScoring({ client, path: { contestId }, body: { eventId } as any });
                      await queryClient.invalidateQueries({ queryKey: ['admin', 'contest', contestId] });
                    }
                  }}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Re-ingest Scoring Data
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="draft">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Draft Status</CardTitle>
              </CardHeader>
              <CardContent>
                {contest.draftStatus ? (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Status</p>
                      <p className="font-medium">{contest.draftStatus.status}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Current Pick</p>
                      <p className="font-medium">{contest.draftStatus.currentPick}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total Picks</p>
                      <p className="font-medium">{contest.draftStatus.totalPicks}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Started</p>
                      <p className="font-medium">{formatDate(contest.draftStatus.startedAt ?? null)}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">This contest does not have a draft session yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pick Log</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-3 text-left font-medium">Round</th>
                      <th className="px-4 py-3 text-left font-medium">Pick #</th>
                      <th className="px-4 py-3 text-left font-medium">Participant</th>
                      <th className="px-4 py-3 text-left font-medium">Owner</th>
                      <th className="px-4 py-3 text-left font-medium">Auto</th>
                      <th className="px-4 py-3 text-left font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contest.picks.map((pick) => (
                      <tr key={`${pick.round}-${pick.pick}`} className="border-b">
                        <td className="px-4 py-3">{pick.round}</td>
                        <td className="px-4 py-3 font-medium">{pick.pick}</td>
                        <td className="px-4 py-3">{pick.participant}</td>
                        <td className="px-4 py-3 text-muted-foreground">{pick.owner}</td>
                        <td className="px-4 py-3">
                          {pick.autoPicked && (
                            <Badge className="bg-orange-100 text-orange-800 text-xs">Auto</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-muted-foreground">
                          <Clock className="mr-1 inline h-3 w-3" />
                          {formatDate(pick.time)}
                        </td>
                      </tr>
                    ))}
                    {contest.picks.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                          No draft picks have been recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="overrides">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Score Overrides</CardTitle>
                <CardDescription>{contest.overrides.length} overrides applied</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                  onClick={async () => {
                    const entryId = window.prompt('Entry ID to override:');
                    if (!entryId) return;
                    const score = window.prompt('New score:');
                    if (!score) return;
                    const reason = await promptReason('override a score');
                    if (!reason || !contestId) return;
                    await adminOverrideScore({
                      client,
                      path: { contestId },
                      body: { entryId, newScore: Number(score), reason } as any,
                    });
                    await queryClient.invalidateQueries({ queryKey: ['admin', 'contest', contestId] });
                  }}
                >
                Override Score
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">Admin</th>
                    <th className="px-4 py-3 text-left font-medium">Entry</th>
                    <th className="px-4 py-3 text-right font-medium">Old Score</th>
                    <th className="px-4 py-3 text-right font-medium">New Score</th>
                    <th className="px-4 py-3 text-left font-medium">Reason</th>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {contest.overrides.map((o) => (
                    <tr key={o.id} className="border-b">
                      <td className="px-4 py-3 text-muted-foreground">{o.adminEmail}</td>
                      <td className="px-4 py-3 font-medium">{o.entryId}</td>
                      <td className="px-4 py-3 text-right font-mono">{o.oldScore}</td>
                      <td className="px-4 py-3 text-right font-mono font-medium">{o.newScore}</td>
                      <td className="px-4 py-3">{o.reason}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(o.createdAt)}</td>
                    </tr>
                  ))}
                  {contest.overrides.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        No score overrides have been applied.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="actions">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-destructive" />
                  Force Close Contest
                </CardTitle>
                <CardDescription>Immediately close this contest and finalize standings.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="destructive"
                onClick={async () => {
                    const reason = await promptReason('force close this contest');
                    if (!reason || !contestId) return;
                    await adminForceCloseContest({ client, path: { contestId }, body: { reason } });
                    await queryClient.invalidateQueries({ queryKey: ['admin', 'contest', contestId] });
                  }}
                >
                  Force Close
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <RotateCcw className="h-4 w-4" />
                  Reopen Contest
                </CardTitle>
                <CardDescription>Reopen a closed or cancelled contest for new entries.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                onClick={async () => {
                    const reason = await promptReason('reopen this contest');
                    if (!reason || !contestId) return;
                    await adminReopenContest({ client, path: { contestId }, body: { reason } });
                    await queryClient.invalidateQueries({ queryKey: ['admin', 'contest', contestId] });
                  }}
                >
                  Reopen
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Calculator className="h-4 w-4" />
                  Recalculate Standings
                </CardTitle>
                <CardDescription>Reprocess all scoring data and recalculate ranks.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="outline"
                  onClick={async () => {
                    const confirmed = await dialog.confirm(
                      'Recalculate Standings',
                      'Are you sure you want to recalculate standings?',
                    );
                    if (!confirmed || !contestId) return;
                    const result = await adminRecalculateStandings({ client, path: { contestId } });
                    setRecalcResult(
                      typeof result.data === 'object' && result.data
                        ? `${(result.data as any).entriesAffected ?? 0} entries affected`
                        : 'Standings recalculated',
                    );
                    await queryClient.invalidateQueries({ queryKey: ['admin', 'contest', contestId] });
                  }}
                >
                  Recalculate
                </Button>
                {recalcResult && (
                  <p className="text-sm text-green-700 font-medium">
                    <CheckCircle className="mr-1 inline h-3 w-3" />
                    Result: {recalcResult}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Recalculate Payouts
                </CardTitle>
                <CardDescription>Recalculate prize distribution based on current standings.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                onClick={async () => {
                    const reason = await promptReason('recalculate payouts');
                    if (!reason || !contestId) return;
                    await adminRecalculatePayouts({ client, path: { contestId } });
                    await queryClient.invalidateQueries({ queryKey: ['admin', 'contest', contestId] });
                  }}
                >
                  Recalculate Payouts
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  Re-ingest Event Data
                </CardTitle>
                <CardDescription>Pull fresh event data from the sports data provider.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  onClick={async () => {
                    const eventId = window.prompt('Event ID to re-ingest:');
                    if (!eventId || !contestId) return;
                    const result = await adminReIngestScoring({ client, path: { contestId }, body: { eventId } as any });
                    setRecalcResult(
                      typeof result.data === 'object' && result.data
                        ? `${(result.data as any).entriesAffected ?? 0} entries affected`
                        : 'Standings refreshed',
                    );
                    await queryClient.invalidateQueries({ queryKey: ['admin', 'contest', contestId] });
                  }}
                >
                  Refresh Standings
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={dialog.open}
        title={dialog.title}
        description={dialog.description}
        confirmLabel={dialog.confirmLabel}
        variant={dialog.variant}
        onConfirm={dialog.onConfirm}
        onCancel={dialog.onCancel}
      />
    </div>
  );
}
