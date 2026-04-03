/**
 * Commissioner contest controls — score adjustment, recalculate, close, reopen, extend deadline.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ContestStatus } from '@poolmaster/shared/domain';
import { Shield, Calculator, CheckCircle, Clock, Edit3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ConfirmDialog, useConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/hooks/use-toast';
import {
  adjustScore,
  client,
  closeContest,
  extendContestDeadline,
  recalculateStandings,
  reopenContest,
} from '@/lib/api';

interface CommissionerContestControlsProps {
  contestId: string;
  contestStatus: string;
  isCommissioner: boolean;
}

type ContestAction = 'recalculate' | 'close' | 'reopen' | 'extend';

export function CommissionerContestControls({
  contestId,
  contestStatus,
  isCommissioner,
}: CommissionerContestControlsProps) {
  const [scoreEntryId, setScoreEntryId] = useState('');
  const [scoreAdjustment, setScoreAdjustment] = useState('');
  const [scoreReason, setScoreReason] = useState('');
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [deadlineValue, setDeadlineValue] = useState('');
  const queryClient = useQueryClient();
  const dialog = useConfirmDialog();

  const invalidateContestQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: ['contests', contestId] });
    await queryClient.invalidateQueries({ queryKey: ['contests', contestId, 'standings'] });
    await queryClient.invalidateQueries({ queryKey: ['contests', contestId, 'poll'] });
  };

  const scoreAdjustmentMutation = useMutation({
    mutationFn: async () => {
      const parsedAdjustment = Number(scoreAdjustment);
      const { error } = await adjustScore({
        client,
        path: { contestId },
        body: {
          entryId: scoreEntryId,
          adjustment: parsedAdjustment,
          reason: scoreReason,
        },
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await invalidateContestQueries();
      setScoreEntryId('');
      setScoreAdjustment('');
      setScoreReason('');
      toast({ title: 'Score adjusted', description: 'The contest entry score was updated.' });
    },
  });

  const lifecycleActionMutation = useMutation({
    mutationFn: async (action: ContestAction) => {
      if (action === 'recalculate') {
        const { error } = await recalculateStandings({
          client,
          path: { contestId },
        });
        if (error) throw error;
        return;
      }

      if (action === 'close') {
        const { error } = await closeContest({
          client,
          path: { contestId },
          body: { reason: lifecycleReason },
        });
        if (error) throw error;
        return;
      }

      if (action === 'reopen') {
        const { error } = await reopenContest({
          client,
          path: { contestId },
          body: { reason: lifecycleReason },
        });
        if (error) throw error;
        return;
      }

      const newEnd = new Date(deadlineValue);
      if (Number.isNaN(newEnd.getTime())) {
        throw new Error('Enter a valid new deadline.');
      }
      const { error } = await extendContestDeadline({
        client,
        path: { contestId },
        body: {
          newEnd: newEnd.toISOString(),
          reason: lifecycleReason,
        },
      });
      if (error) throw error;
    },
    onSuccess: async (_, action) => {
      await invalidateContestQueries();
      setLifecycleReason('');
      if (action === 'extend') {
        setDeadlineValue('');
      }
      toast({
        title: 'Contest updated',
        description:
          action === 'recalculate'
            ? 'Standings were recalculated.'
            : action === 'extend'
              ? 'Contest deadline was extended.'
              : action === 'close'
                ? 'Contest was closed.'
                : 'Contest was reopened.',
      });
    },
  });

  if (!isCommissioner) return null;

  const isActive = contestStatus === ContestStatus.ACTIVE || contestStatus === ContestStatus.LOCKED;
  const isCompleted = contestStatus === ContestStatus.COMPLETED;

  async function handleLifecycleAction(action: ContestAction) {
    const descriptions: Record<ContestAction, string> = {
      recalculate: 'Recalculate standings from current entry scores. Rankings may change immediately.',
      close: 'Close this contest and mark it completed.',
      reopen: 'Reopen this contest and allow standings or score changes again.',
      extend: 'Extend the contest deadline to the new timestamp below.',
    };

    const confirmed = await dialog.confirm(
      action === 'recalculate'
        ? 'Recalculate Standings'
        : action === 'close'
          ? 'Close Contest'
          : action === 'reopen'
            ? 'Reopen Contest'
            : 'Extend Deadline',
      descriptions[action],
      { confirmLabel: 'Confirm', variant: action === 'close' ? 'destructive' : 'default' },
    );

    if (!confirmed) {
      return;
    }

    try {
      await lifecycleActionMutation.mutateAsync(action);
    } catch (error) {
      toast({
        title: 'Unable to update contest',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  }

  return (
    <Card className="border-amber-200 dark:border-amber-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Shield className="h-4 w-4 text-amber-600" />
          Commissioner Controls
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isActive && (
          <div className="space-y-2">
            <Label className="text-xs font-medium">Score Adjustment</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Entry ID"
                value={scoreEntryId}
                onChange={(event) => setScoreEntryId(event.target.value)}
                className="h-8 text-xs"
              />
              <Input
                type="number"
                placeholder="Delta"
                value={scoreAdjustment}
                onChange={(event) => setScoreAdjustment(event.target.value)}
                className="h-8 text-xs w-24"
              />
            </div>
            <Input
              placeholder="Reason for adjustment"
              value={scoreReason}
              onChange={(event) => setScoreReason(event.target.value)}
              className="h-8 text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Use a positive or negative delta. This API adjusts the current score instead of replacing it.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => scoreAdjustmentMutation.mutate()}
              disabled={
                !scoreEntryId
                || !scoreAdjustment
                || !scoreReason
                || scoreAdjustmentMutation.isPending
              }
            >
              <Edit3 className="h-3 w-3 mr-1" />
              Apply Adjustment
            </Button>
          </div>
        )}

        {isActive && <Separator />}

        <div className="space-y-2">
          {(isActive || isCompleted) && (
            <Input
              placeholder="Reason for lifecycle change"
              value={lifecycleReason}
              onChange={(event) => setLifecycleReason(event.target.value)}
              className="h-8 text-xs"
            />
          )}

          {isActive && (
            <div className="space-y-2">
              <Label className="text-xs font-medium">New Deadline</Label>
              <Input
                type="datetime-local"
                value={deadlineValue}
                onChange={(event) => setDeadlineValue(event.target.value)}
                className="h-8 text-xs"
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {isActive && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => handleLifecycleAction('recalculate')}
                disabled={lifecycleActionMutation.isPending}
              >
                <Calculator className="h-3 w-3 mr-1" />
                Recalculate Standings
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => handleLifecycleAction('extend')}
                disabled={!deadlineValue || !lifecycleReason || lifecycleActionMutation.isPending}
              >
                <Clock className="h-3 w-3 mr-1" />
                Extend Deadline
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => handleLifecycleAction('close')}
                disabled={!lifecycleReason || lifecycleActionMutation.isPending}
              >
                <CheckCircle className="h-3 w-3 mr-1" />
                Close Contest
              </Button>
            </>
          )}

          {isCompleted && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => handleLifecycleAction('reopen')}
              disabled={!lifecycleReason || lifecycleActionMutation.isPending}
            >
              Reopen Contest
            </Button>
          )}
        </div>

        <ConfirmDialog
          open={dialog.open}
          title={dialog.title}
          description={dialog.description}
          confirmLabel={dialog.confirmLabel}
          variant={dialog.variant}
          onConfirm={dialog.onConfirm}
          onCancel={dialog.onCancel}
        />
      </CardContent>
    </Card>
  );
}
