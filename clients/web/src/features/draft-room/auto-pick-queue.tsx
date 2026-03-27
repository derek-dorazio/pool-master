import { useState } from 'react';
import { GripVertical, X, Wand2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AvailableParticipant } from './hooks/use-draft';

interface AutoPickQueueProps {
  queue: AvailableParticipant[];
  onReorder: (queue: AvailableParticipant[]) => void;
  onRemove: (participantId: string) => void;
  onClear: () => void;
  onAutoFill: () => void;
}

export function AutoPickQueue({ queue, onReorder, onRemove, onClear, onAutoFill }: AutoPickQueueProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  function handleDragStart(idx: number) {
    setDragIdx(idx);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    setOverIdx(idx);
  }

  function handleDrop(idx: number) {
    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null);
      setOverIdx(null);
      return;
    }
    const updated = [...queue];
    const [moved] = updated.splice(dragIdx, 1);
    updated.splice(idx, 0, moved);
    onReorder(updated);
    setDragIdx(null);
    setOverIdx(null);
  }

  // Keyboard reorder
  function handleKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key === 'ArrowUp' && idx > 0) {
      e.preventDefault();
      const updated = [...queue];
      [updated[idx - 1], updated[idx]] = [updated[idx], updated[idx - 1]];
      onReorder(updated);
    }
    if (e.key === 'ArrowDown' && idx < queue.length - 1) {
      e.preventDefault();
      const updated = [...queue];
      [updated[idx], updated[idx + 1]] = [updated[idx + 1], updated[idx]];
      onReorder(updated);
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      onRemove(queue[idx].id);
    }
  }

  return (
    <div className="border-t">
      <div className="flex items-center justify-between px-3 py-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Auto-Pick Queue ({queue.length})
        </h4>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onAutoFill} title="Auto-fill from rankings">
            <Wand2 className="h-3 w-3" />
          </Button>
          {queue.length > 0 && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClear} title="Clear queue">
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {queue.length === 0 ? (
        <p className="px-3 pb-3 text-xs text-muted-foreground">
          Add players here to set your auto-pick priority. If your timer expires, the top available player from this queue will be drafted.
        </p>
      ) : (
        <div className="pb-2">
          {queue.map((participant, idx) => (
            <div
              key={participant.id}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={() => handleDrop(idx)}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              tabIndex={0}
              role="listitem"
              aria-label={`Queue position ${idx + 1}: ${participant.name}`}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-grab active:cursor-grabbing hover:bg-accent transition-colors ${
                overIdx === idx ? 'border-t-2 border-primary' : ''
              } ${dragIdx === idx ? 'opacity-50' : ''}`}
            >
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground w-4">{idx + 1}.</span>
              <span className="flex-1 truncate">{participant.name}</span>
              <span className="text-xs text-muted-foreground">{participant.position}</span>
              <button onClick={() => onRemove(participant.id)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
