import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Trophy, RefreshCw, AlertTriangle, XCircle,
  RotateCcw, Calculator, DollarSign, Download,
  CheckCircle, Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ConfirmDialog, useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useContestDetail } from '@/hooks/use-contests-api';

function statusColor(status: string) {
  switch (status) {
    case 'Open': return 'bg-blue-100 text-blue-800';
    case 'Drafting': return 'bg-yellow-100 text-yellow-800';
    case 'Active': return 'bg-green-100 text-green-800';
    case 'Completed': return 'bg-gray-100 text-gray-800';
    case 'Cancelled': return 'bg-red-100 text-red-800';
    default: return 'bg-gray-100 text-gray-800';
  }
}

export function Component() {
  const { contestId } = useParams<{ contestId: string }>();
  const { data: contest } = useContestDetail(contestId ?? '');
  const [recalcResult, setRecalcResult] = useState<string | null>(null);
  const dialog = useConfirmDialog();

  if (!contest) return null;

  async function confirmAction(label: string, callback?: () => void) {
    const confirmed = await dialog.confirm(
      'Confirm Action',
      `Are you sure you want to ${label}?`,
      { confirmLabel: 'Confirm', variant: 'destructive' },
    );
    if (confirmed) {
      callback?.();
    }
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link to="/contests" className="hover:text-foreground">Contests</Link>
        <span>/</span>
        <span>{contest.tenant}</span>
        <span>/</span>
        <span>{contest.league}</span>
        <span>/</span>
        <span className="text-foreground">{contest.name}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Trophy className="h-6 w-6" />
            <h1 className="text-2xl font-bold">{contest.name}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-purple-100 text-purple-800">{contest.sportEmoji} {contest.sport}</Badge>
            <Badge variant="outline">{contest.type}</Badge>
            <Badge variant="outline">{contest.selectionType}</Badge>
            <Badge className={cn(statusColor(contest.status))}>{contest.status}</Badge>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="standings">
        <TabsList>
          <TabsTrigger value="standings">Standings</TabsTrigger>
          <TabsTrigger value="scoring">Scoring Data</TabsTrigger>
          <TabsTrigger value="draft">Draft</TabsTrigger>
          <TabsTrigger value="overrides">Overrides</TabsTrigger>
          <TabsTrigger value="actions">Admin Actions</TabsTrigger>
        </TabsList>

        {/* Standings */}
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
                    <tr key={entry.rank} className="border-b">
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

        {/* Scoring Data */}
        <TabsContent value="scoring">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Scoring Freshness</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  {contest.lastStatEvent.includes('minute') && parseInt(contest.lastStatEvent) <= 5 ? (
                    <>
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      <span className="text-green-700 font-medium">
                        Last stat event: {contest.lastStatEvent}
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-5 w-5 text-red-600" />
                      <span className="text-red-700 font-medium">
                        STALE: {contest.lastStatEvent}
                      </span>
                    </>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {contest.statEventsProcessed.toLocaleString()} stat events processed, {contest.corrections} corrections applied
                </p>
                <Button variant="outline" onClick={() => confirmAction('re-ingest scoring data')}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Re-ingest Scoring Data
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Draft */}
        <TabsContent value="draft">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Draft Status</CardTitle>
              </CardHeader>
              <CardContent>
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
                    <p className="font-medium">{new Date(contest.draftStatus.started).toLocaleString()}</p>
                  </div>
                </div>
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
                      <tr key={pick.pick} className="border-b">
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
                          {pick.time}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Overrides */}
        <TabsContent value="overrides">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Score Overrides</CardTitle>
                <CardDescription>{contest.overrides.length} overrides applied</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => confirmAction('override a score')}>
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
                  {contest.overrides.map((o, i) => (
                    <tr key={i} className="border-b">
                      <td className="px-4 py-3 text-muted-foreground">{o.admin}</td>
                      <td className="px-4 py-3 font-medium">{o.entry}</td>
                      <td className="px-4 py-3 text-right font-mono">{o.oldScore}</td>
                      <td className="px-4 py-3 text-right font-mono font-medium">{o.newScore}</td>
                      <td className="px-4 py-3">{o.reason}</td>
                      <td className="px-4 py-3 text-muted-foreground">{o.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Admin Actions */}
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
                  onClick={() => confirmAction('force close this contest')}
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
                  onClick={() => confirmAction('reopen this contest')}
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
                    if (confirmed) {
                      setRecalcResult('3 rank changes');
                    }
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
                  onClick={() => confirmAction('recalculate payouts')}
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
                  onClick={() => confirmAction('re-ingest event data')}
                >
                  Re-ingest
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
