import { useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { useDraft, useMakePick, type AvailableParticipant } from '@/features/draft-room/hooks/use-draft';
import { DraftHeader } from '@/features/draft-room/draft-header';
import { AvailablePanel } from '@/features/draft-room/available-panel';
import { PickBoard } from '@/features/draft-room/pick-board';
import { RosterPanel } from '@/features/draft-room/roster-panel';
import { Button } from '@/components/ui/button';
import { MessageSquare, X } from 'lucide-react';

export function Component() {
  const { draftId } = useParams<{ draftId: string }>();
  const { data: draft, isLoading, error } = useDraft(draftId!);
  const makePick = useMakePick(draftId!);
  const [selectedParticipant, setSelectedParticipant] = useState<AvailableParticipant | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [confirmingPick, setConfirmingPick] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center space-y-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto" />
          <p className="text-sm text-muted-foreground">Loading draft room...</p>
        </div>
      </div>
    );
  }

  if (error || !draft) {
    return <Navigate to="/dashboard" replace />;
  }

  function handleDraft(participantId: string) {
    setConfirmingPick(participantId);
  }

  function confirmPick() {
    if (!confirmingPick) return;
    makePick.mutate(confirmingPick);
    setConfirmingPick(null);
    setSelectedParticipant(null);
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Top bar */}
      <DraftHeader draft={draft} />

      {/* Main panels */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Available participants */}
        <div className="w-72 shrink-0 hidden lg:flex flex-col">
          <AvailablePanel
            draftId={draft.id}
            onDraft={handleDraft}
            onSelect={setSelectedParticipant}
            isDrafting={makePick.isPending}
            isMyPick={draft.isMyPick}
          />
        </div>

        {/* Centre: Pick board */}
        <div className="flex-1 min-w-0 flex flex-col">
          <PickBoard draft={draft} />
        </div>

        {/* Right: My roster */}
        <div className="w-64 shrink-0 hidden lg:flex flex-col">
          <RosterPanel draft={draft} />
        </div>
      </div>

      {/* Bottom: Chat toggle */}
      <div className="border-t bg-background">
        {chatOpen ? (
          <div className="h-48 flex flex-col">
            <div className="flex items-center justify-between px-3 py-1.5 border-b">
              <span className="text-xs font-medium">Draft Chat</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setChatOpen(false)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              <div className="text-xs text-muted-foreground text-center py-4">
                Chat messages will appear here during the draft.
              </div>
            </div>
            <div className="flex gap-2 px-3 py-2 border-t">
              <input
                placeholder="Type a message..."
                className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
              />
              <Button size="sm">Send</Button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setChatOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground w-full"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Draft Chat
          </button>
        )}
      </div>

      {/* Pick confirmation dialog */}
      {confirmingPick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg shadow-lg p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="text-lg font-semibold">Confirm Pick</h3>
            <p className="text-sm text-muted-foreground">
              Draft this player with pick #{draft.currentPickNumber}?
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setConfirmingPick(null)}>Cancel</Button>
              <Button onClick={confirmPick} disabled={makePick.isPending}>
                {makePick.isPending ? 'Drafting...' : 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Participant detail drawer */}
      {selectedParticipant && !confirmingPick && (
        <div className="fixed inset-y-0 right-0 z-40 w-80 bg-background shadow-lg border-l flex flex-col">
          <div className="flex items-center justify-between p-4 border-b">
            <h3 className="font-semibold">{selectedParticipant.name}</h3>
            <Button variant="ghost" size="icon" onClick={() => setSelectedParticipant(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Position:</span> {selectedParticipant.position}</div>
              <div><span className="text-muted-foreground">Team:</span> {selectedParticipant.team}</div>
              <div><span className="text-muted-foreground">Ranking:</span> #{selectedParticipant.ranking}</div>
              <div><span className="text-muted-foreground">Form:</span> {selectedParticipant.formRating.toFixed(1)}</div>
              <div><span className="text-muted-foreground">Status:</span> {selectedParticipant.injuryStatus}</div>
            </div>
          </div>
          <div className="p-4 border-t flex gap-2">
            {draft.isMyPick && (
              <Button className="flex-1" onClick={() => handleDraft(selectedParticipant.id)}>
                Draft {selectedParticipant.name}
              </Button>
            )}
            <Button variant="outline" className="flex-1" onClick={() => setSelectedParticipant(null)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
