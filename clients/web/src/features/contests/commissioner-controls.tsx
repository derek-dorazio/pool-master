/**
 * Commissioner contest controls — score override, recalculate, close/cancel, extend deadline.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, Calculator, XCircle, CheckCircle, Clock, Edit3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

interface CommissionerContestControlsProps {
  contestId: string;
  contestStatus: string;
  isCommissioner: boolean;
}

export function CommissionerContestControls({ contestId, contestStatus, isCommissioner }: CommissionerContestControlsProps) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [overrideEntryId, setOverrideEntryId] = useState('');
  const [overrideScore, setOverrideScore] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [extendHours, setExtendHours] = useState('24');
  const queryClient = useQueryClient();

  const action = useMutation({
    mutationFn: async (params: { action: string; data?: Record<string, unknown> }) => {
      // TODO: Replace with real API
      await new Promise((r) => setTimeout(r, 300));
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contests', contestId] });
      setConfirming(null);
      setOverrideEntryId('');
      setOverrideScore('');
      setOverrideReason('');
    },
  });

  if (!isCommissioner) return null;

  const isActive = contestStatus === 'ACTIVE' || contestStatus === 'LOCKED';
  const isCompleted = contestStatus === 'COMPLETED';

  return (
    <Card className="border-amber-200 dark:border-amber-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="h-4 w-4 text-amber-600" />
          Commissioner Controls
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Score Override */}
        {isActive && (
          <div className="space-y-2">
            <Label className="text-xs font-medium">Score Override</Label>
            <div className="flex gap-2">
              <Input placeholder="Entry ID" value={overrideEntryId} onChange={(e) => setOverrideEntryId(e.target.value)} className="h-8 text-xs" />
              <Input type="number" placeholder="Score" value={overrideScore} onChange={(e) => setOverrideScore(e.target.value)} className="h-8 text-xs w-24" />
            </div>
            <Input placeholder="Reason for override" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} className="h-8 text-xs" />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => action.mutate({ action: 'score-override', data: { entryId: overrideEntryId, score: Number(overrideScore), reason: overrideReason } })}
              disabled={!overrideEntryId || !overrideScore || !overrideReason || action.isPending}
            >
              <Edit3 className="h-3 w-3 mr-1" /> Apply Override
            </Button>
          </div>
        )}

        {isActive && <Separator />}

        {/* Quick actions */}
        <div className="flex flex-wrap gap-2">
          {isActive && (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirming('recalculate')} disabled={action.isPending}>
                <Calculator className="h-3 w-3 mr-1" /> Recalculate Scores
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirming('extend')} disabled={action.isPending}>
                <Clock className="h-3 w-3 mr-1" /> Extend Deadline
              </Button>
            </>
          )}

          {isActive && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirming('close')} disabled={action.isPending}>
              <CheckCircle className="h-3 w-3 mr-1" /> Close Contest
            </Button>
          )}

          {(isActive || contestStatus === 'OPEN' || contestStatus === 'DRAFTING') && (
            <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" onClick={() => setConfirming('cancel')} disabled={action.isPending}>
              <XCircle className="h-3 w-3 mr-1" /> Cancel Contest
            </Button>
          )}

          {isCompleted && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setConfirming('reopen')} disabled={action.isPending}>
              Reopen Contest
            </Button>
          )}
        </div>

        {/* Confirmation dialogs */}
        {confirming && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-background rounded-lg shadow-lg p-6 max-w-sm w-full mx-4 space-y-4">
              <h3 className="text-lg font-semibold">
                {confirming === 'recalculate' && 'Recalculate Scores'}
                {confirming === 'close' && 'Close Contest'}
                {confirming === 'cancel' && 'Cancel Contest'}
                {confirming === 'reopen' && 'Reopen Contest'}
                {confirming === 'extend' && 'Extend Deadline'}
              </h3>
              <p className="text-sm text-muted-foreground">
                {confirming === 'recalculate' && 'This will recalculate all scores from the source data. Standings may change.'}
                {confirming === 'close' && 'Close this contest and finalize results. This triggers payouts and awards.'}
                {confirming === 'cancel' && 'Cancel this contest? All entries and scores will be preserved but the contest will be marked as cancelled.'}
                {confirming === 'reopen' && 'Reopen this completed contest? This will allow score changes and delay final results.'}
                {confirming === 'extend' && 'Extend the contest deadline.'}
              </p>
              {confirming === 'extend' && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Hours:</Label>
                  <Input type="number" value={extendHours} onChange={(e) => setExtendHours(e.target.value)} className="h-8 w-24 text-xs" />
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setConfirming(null)}>Cancel</Button>
                <Button
                  variant={confirming === 'cancel' ? 'destructive' : 'default'}
                  onClick={() => action.mutate({ action: confirming, data: confirming === 'extend' ? { hours: Number(extendHours) } : undefined })}
                  disabled={action.isPending}
                >
                  {action.isPending ? 'Processing...' : 'Confirm'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
