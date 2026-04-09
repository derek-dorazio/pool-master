import { DraftStatus } from '@poolmaster/shared/domain';
import { Loader2, Pause, Play, Plus, RotateCcw, Shield, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useExtendDraft, usePauseDraft, useResumeDraft, useSkipDraft, useUndoDraft } from './hooks/use-draft';
import type { DraftState } from './hooks/use-draft';

interface CommissionerControlsProps {
  draftId: string;
  draftStatus: DraftState['status'];
  isCommissioner: boolean;
}

export function CommissionerControls({
  draftId,
  draftStatus,
  isCommissioner,
}: CommissionerControlsProps) {
  const pauseMutation = usePauseDraft(draftId);
  const resumeMutation = useResumeDraft(draftId);
  const extendMutation = useExtendDraft(draftId);
  const undoMutation = useUndoDraft(draftId);
  const skipMutation = useSkipDraft(draftId);

  if (!isCommissioner || draftStatus === DraftStatus.COMPLETE) {
    return null;
  }

  const isPending = pauseMutation.isPending || resumeMutation.isPending || extendMutation.isPending || undoMutation.isPending || skipMutation.isPending;
  const canPause = draftStatus === DraftStatus.LIVE;
  const canResume = draftStatus === DraftStatus.PAUSED;
  const canExtend = draftStatus === DraftStatus.LIVE;
  const canUndo = draftStatus === DraftStatus.LIVE || draftStatus === DraftStatus.PAUSED;
  const canSkip = draftStatus === DraftStatus.LIVE;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <div className="flex items-center gap-2 font-medium">
        <Shield className="h-4 w-4" />
        <span>Commissioner Controls</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!canPause || isPending}
          onClick={() => pauseMutation.mutate()}
        >
          {pauseMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Pause className="mr-1 h-4 w-4" />}
          Pause
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={!canResume || isPending}
          onClick={() => resumeMutation.mutate()}
        >
          {resumeMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
          Resume
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={!canExtend || isPending}
          onClick={() => extendMutation.mutate(60)}
        >
          {extendMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
          Add 60s
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={!canUndo || isPending}
          onClick={() => undoMutation.mutate()}
        >
          {undoMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1 h-4 w-4" />}
          Undo
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={!canSkip || isPending}
          onClick={() => skipMutation.mutate()}
        >
          {skipMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <SkipForward className="mr-1 h-4 w-4" />}
          Skip
        </Button>
      </div>
    </div>
  );
}
