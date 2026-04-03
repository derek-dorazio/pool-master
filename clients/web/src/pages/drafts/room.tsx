import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAutoFillBracket, useDraft, useMakePick, useResetBracket, type AvailableParticipant } from '@/features/draft-room/hooks/use-draft';
import { DraftHeader } from '@/features/draft-room/draft-header';
import { AvailablePanel } from '@/features/draft-room/available-panel';
import { PickBoard } from '@/features/draft-room/pick-board';
import { RosterPanel } from '@/features/draft-room/roster-panel';
import { TieredBoard } from '@/features/draft-room/tiered-board';
import { SelectionOverview } from '@/features/draft-room/selection-overview';
import { PickEmPanel } from '@/features/draft-room/pickem-panel';
import { BracketPanel } from '@/features/draft-room/bracket-panel';
import { CommissionerControls } from '@/features/draft-room/commissioner-controls';
import { ChatPanel } from '@/features/social/chat-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { X } from 'lucide-react';

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'This draft room is unavailable right now.';
}

export function Component() {
  const { draftId } = useParams<{ draftId: string }>();
  const { data: draft, isLoading, error } = useDraft(draftId!);
  const makePick = useMakePick(draftId!);
  const resetBracket = useResetBracket(draftId!);
  const autoFillBracket = useAutoFillBracket(draftId!);
  const [selectedParticipant, setSelectedParticipant] = useState<AvailableParticipant | null>(null);
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
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Draft room unavailable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {getErrorMessage(error)}
            </p>
            <Button asChild variant="outline">
              <Link to={`/contests/${draftId}`}>Back to Contest</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const myEntryId = draft.myEntryId;
  const isTiered = draft.selectionType === 'TIERED' && (draft.selectionConfig?.tierConfig?.length ?? 0) > 0;
  const isPickEm = draft.selectionType === 'PICK_EM';
  const isBracket = draft.selectionType === 'BRACKET_PICK_EM';
  const isSimpleSelection = !draft.isTurnBased && !isTiered && !isBracket;
  const bracketMatchups = draft.bracketMatchups ?? [];
  const requiresEntry = draft.myEntryId == null;

  function handleDraft(participantId: string) {
    if (requiresEntry) return;
    setConfirmingPick(participantId);
  }

  function confirmPick() {
    if (!confirmingPick || !myEntryId) return;
    makePick.mutate({ entryId: myEntryId, participantId: confirmingPick });
    setConfirmingPick(null);
    setSelectedParticipant(null);
  }

  function handlePickEmPick(eventId: string, participantId: string, matchupIndex: number, period: number) {
    if (!myEntryId) return;
    makePick.mutate({ entryId: myEntryId, participantId, eventId, matchupIndex, period });
  }

  function handlePickEmConfidence(eventId: string, participantId: string, matchupIndex: number, period: number, weight: number) {
    if (!myEntryId) return;
    makePick.mutate({
      entryId: myEntryId,
      participantId,
      eventId,
      matchupIndex,
      period,
      confidenceWeight: weight,
    });
  }

  function handleBracketPick(matchupId: string, winnerId: string) {
    if (!myEntryId) return;
    const matchup = bracketMatchups.find((item) => item.id === matchupId);
    if (!matchup) return;
    makePick.mutate({
      entryId: myEntryId,
      participantId: winnerId,
      roundNumber: matchup.roundNumber,
      matchNumber: matchup.matchNumber,
    });
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Top bar */}
      <DraftHeader draft={draft} />

      <div className="border-b bg-background px-4 py-2">
        <CommissionerControls
          draftId={draft.contestId}
          draftStatus={draft.status}
          isCommissioner={Boolean(draft.isCommissioner)}
        />
      </div>

      {/* Main panels */}
      <div className="flex-1 flex min-h-0">
        {requiresEntry ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <Card className="w-full max-w-2xl">
              <CardHeader>
                <CardTitle>Contest entry required</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  You need an active contest entry before you can participate in this draft or selection room.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button asChild>
                    <Link to={`/contests/${draft.contestId}`}>Go to Contest</Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to={`/contests/${draft.contestId}`}>Create or join your entry</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
        {/* Left: Available participants */}
        {!isPickEm && !isBracket && (
          <div className="w-72 shrink-0 hidden lg:flex flex-col">
            <AvailablePanel
              draftId={draft.contestId}
              draftedParticipantIds={draft.picks.map((pick) => pick.participantId).filter((value): value is string => Boolean(value))}
              onDraft={handleDraft}
              onSelect={setSelectedParticipant}
              isDrafting={makePick.isPending}
              isMyPick={draft.isMyPick}
              selectionType={draft.selectionType}
            />
          </div>
        )}

        {/* Centre: Pick board */}
        <div className="flex-1 min-w-0 flex flex-col">
          {isPickEm ? (
            <PickEmPanel
              events={(draft.pickEmEvents ?? []).map((event) => ({
                id: event.id,
                homeTeam: event.homeParticipantName ?? 'TBD',
                awayTeam: event.awayParticipantName ?? 'TBD',
                eventTime: event.eventTime ?? new Date().toISOString(),
                deadline: event.deadline ?? event.eventTime ?? new Date().toISOString(),
                isLocked: event.isLocked,
                myPick: event.myPickParticipantId === event.homeParticipantId
                  ? 'home'
                  : event.myPickParticipantId === event.awayParticipantId
                    ? 'away'
                    : undefined,
                confidencePoints: event.confidenceWeight ?? undefined,
              }))}
              useConfidence={Boolean(draft.selectionConfig?.picksPerPeriod && draft.rosterSize > 1)}
              totalPicks={draft.pickEmEvents?.length ?? 0}
              madePicks={(draft.pickEmEvents ?? []).filter((event) => event.myPickParticipantId).length}
              onPick={(eventId, side) => {
                const event = draft.pickEmEvents?.find((item) => item.id === eventId);
                if (!event) return;
                const participantId = side === 'home' ? event.homeParticipantId : event.awayParticipantId;
                if (!participantId) return;
                handlePickEmPick(event.eventId ?? event.id, participantId, event.matchupIndex, event.period);
              }}
              onConfidence={(eventId, points) => {
                const event = draft.pickEmEvents?.find((item) => item.id === eventId);
                if (!event || !event.myPickParticipantId) return;
                handlePickEmConfidence(
                  event.eventId ?? event.id,
                  event.myPickParticipantId,
                  event.matchupIndex,
                  event.period,
                  points,
                );
              }}
            />
          ) : isBracket ? (
            <BracketPanel
              matchups={bracketMatchups.map((matchup) => ({
                id: matchup.id,
                round: matchup.roundNumber,
                matchNumber: matchup.matchNumber,
                topTeam: matchup.topTeam
                  ? {
                      id: matchup.topTeam.id,
                      name: matchup.topTeam.name,
                      seed: matchup.topTeam.seed,
                    }
                  : null,
                bottomTeam: matchup.bottomTeam
                  ? {
                      id: matchup.bottomTeam.id,
                      name: matchup.bottomTeam.name,
                      seed: matchup.bottomTeam.seed,
                    }
                  : null,
                winnerId: matchup.winnerId,
              }))}
              totalMatchups={bracketMatchups.length}
              completedPicks={bracketMatchups.filter((matchup) => matchup.winnerId).length}
              championId={
                [...bracketMatchups]
                  .sort((a, b) => {
                    if (a.roundNumber !== b.roundNumber) return b.roundNumber - a.roundNumber;
                    return b.matchNumber - a.matchNumber;
                  })[0]?.winnerId ?? null
              }
              onPickWinner={handleBracketPick}
              onReset={() => resetBracket.mutate()}
              onAutoFill={() => autoFillBracket.mutate()}
              isLocked={!draft.isMyPick || resetBracket.isPending || autoFillBracket.isPending || makePick.isPending}
            />
          ) : isTiered ? (
            <TieredBoard draft={draft} tiers={draft.selectionConfig?.tierConfig ?? []} />
          ) : isSimpleSelection ? (
            <SelectionOverview draft={draft} />
          ) : (
            <PickBoard draft={draft} />
          )}
        </div>

        {/* Right: My roster */}
        <div className="w-64 shrink-0 hidden lg:flex flex-col">
          {isPickEm || isBracket ? <SelectionOverview draft={draft} /> : <RosterPanel draft={draft} />}
        </div>
          </>
        )}
      </div>

      {/* Bottom: Chat toggle */}
      <div className="border-t bg-background">
        <div className="p-3">
          <ChatPanel contestId={draft.contestId} />
        </div>
      </div>

      {/* Pick confirmation dialog */}
      {confirmingPick && !requiresEntry && !isPickEm && !isBracket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background rounded-lg shadow-lg p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="text-lg font-semibold">Confirm Pick</h3>
            <p className="text-sm text-muted-foreground">
              {draft.isTurnBased
                ? `Draft this participant with pick #${draft.currentPickNumber}?`
                : 'Add this participant to your roster?'}
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
      {selectedParticipant && !confirmingPick && !isPickEm && !isBracket && (
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
