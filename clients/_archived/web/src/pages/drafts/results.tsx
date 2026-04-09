import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { SelectionType } from '@poolmaster/shared/domain';
import type { DraftStateResponse } from '@poolmaster/shared/dto';
import { DraftStateResponseSchema } from '@poolmaster/shared/dto';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  formatSelectionTypeLabel,
  getSelectionConfigDetailRows,
} from '@/features/contests/selection-config-summary';
import { client, getDraftState } from '@/lib/api';

function formatDraftStatus(status: string) {
  switch (status) {
    case 'PENDING':
      return 'Pending';
    case 'LIVE':
      return 'Live';
    case 'PAUSED':
      return 'Paused';
    case 'COMPLETE':
      return 'Complete';
    default:
      return status;
  }
}

function getResultsCopy(selectionType: string) {
  switch (selectionType) {
    case SelectionType.SNAKE_DRAFT:
      return {
        titleSuffix: 'Draft Results',
        itemLabel: 'picks',
        listTitle: 'All Picks',
        rosterTitle: 'Entry Rosters',
        stateTitle: 'Current Draft State',
        inProgress: 'This draft is still in progress. Results reflect the current saved draft state and do not include any post-draft analysis.',
        roundLabel: 'Rd',
        participantLabel: 'Participant',
        typeLabel: 'Type',
        contextLabel: 'Pick Context',
      };
    case SelectionType.PICK_EM:
      return {
        titleSuffix: "Pick'em Results",
        itemLabel: 'predictions',
        listTitle: 'All Predictions',
        rosterTitle: 'Entry Predictions',
        stateTitle: 'Current Pick\'em State',
        inProgress: 'This pick\'em room is still in progress. Results reflect the current saved selections.',
        roundLabel: 'Period',
        participantLabel: 'Selection',
        typeLabel: 'Confidence',
        contextLabel: 'Matchup',
      };
    case SelectionType.BRACKET_PICK_EM:
      return {
        titleSuffix: 'Bracket Results',
        itemLabel: 'predictions',
        listTitle: 'All Predictions',
        rosterTitle: 'Entry Brackets',
        stateTitle: 'Current Bracket State',
        inProgress: 'This bracket room is still in progress. Results reflect the current saved bracket predictions.',
        roundLabel: 'Round',
        participantLabel: 'Predicted Winner',
        typeLabel: 'Type',
        contextLabel: 'Matchup',
      };
    case SelectionType.TIERED:
      return {
        titleSuffix: 'Tiered Results',
        itemLabel: 'selections',
        listTitle: 'All Tiered Selections',
        rosterTitle: 'Entry Tier Cards',
        stateTitle: 'Current Tiered State',
        inProgress: 'This tiered room is still in progress. Results reflect the current saved tier selections.',
        roundLabel: 'Tier Slot',
        participantLabel: 'Contestant',
        typeLabel: 'Tier',
        contextLabel: 'Selection Context',
      };
    case SelectionType.BUDGET_PICK:
      return {
        titleSuffix: 'Budget Results',
        itemLabel: 'selections',
        listTitle: 'All Budget Selections',
        rosterTitle: 'Entry Budget Cards',
        stateTitle: 'Current Budget State',
        inProgress: 'This budget room is still in progress. Results reflect the current saved selections and spend.',
        roundLabel: 'Slot',
        participantLabel: 'Contestant',
        typeLabel: 'Price',
        contextLabel: 'Selection Context',
      };
    default:
      return {
        titleSuffix: 'Selection Results',
        itemLabel: 'selections',
        listTitle: 'All Selections',
        rosterTitle: 'Entry Selections',
        stateTitle: 'Current Room State',
        inProgress: 'This entry room is still in progress. Results reflect the current saved selections.',
        roundLabel: 'Round',
        participantLabel: 'Selection',
        typeLabel: 'Type',
        contextLabel: 'Selection Context',
      };
  }
}

function formatPickContext(selectionType: string, round: number, pickNumber: number, pickInRound: number) {
  if (selectionType === SelectionType.PICK_EM) {
    return `Period ${round}, Matchup ${pickInRound}`;
  }
  if (selectionType === SelectionType.BRACKET_PICK_EM) {
    return `Round ${round}, Match ${pickInRound}`;
  }
  return `Rd ${round}, Pick #${pickNumber}`;
}

function getPickEmMatchupLabel(
  draft: DraftStateResponse,
  round: number,
  pickInRound: number,
) {
  const matchup = draft.pickEmEvents?.find(
    (event: NonNullable<DraftStateResponse['pickEmEvents']>[number]) =>
      event.period === round && event.matchupIndex === pickInRound,
  );
  if (!matchup) return null;

  const fallbackLabel = [matchup.awayParticipantName, matchup.homeParticipantName].filter(Boolean).join(' at ');
  return matchup.label ?? (fallbackLabel || `Matchup ${pickInRound}`);
}

function getBracketMatchupLabel(
  draft: DraftStateResponse,
  round: number,
  pickInRound: number,
) {
  const matchup = draft.bracketMatchups?.find(
    (item: NonNullable<DraftStateResponse['bracketMatchups']>[number]) =>
      item.roundNumber === round && item.matchNumber === pickInRound,
  );
  if (!matchup) return null;

  const fallbackLabel = [matchup.topTeam?.name, matchup.bottomTeam?.name].filter(Boolean).join(' vs ');
  return matchup.label ?? (fallbackLabel || `Match ${pickInRound}`);
}

function getPickDetailLabel(
  draft: DraftStateResponse,
  pick: DraftStateResponse['picks'][number],
) {
  if (draft.selectionType === SelectionType.PICK_EM) {
    return getPickEmMatchupLabel(draft, pick.round, pick.pickInRound);
  }

  if (draft.selectionType === SelectionType.BRACKET_PICK_EM) {
    return getBracketMatchupLabel(draft, pick.round, pick.pickInRound);
  }

  return null;
}

function getTypeBadgeLabel(draft: DraftStateResponse, pick: DraftStateResponse['picks'][number]) {
  if (pick.isSkipped) return 'Skipped';

  if (draft.selectionType === SelectionType.PICK_EM) {
    return `Matchup ${pick.pickInRound}`;
  }

  if (draft.selectionType === SelectionType.TIERED) {
    return pick.tierName ?? 'Tier';
  }

  if (draft.selectionType === SelectionType.BUDGET_PICK) {
    return typeof pick.price === 'number' ? `$${pick.price.toLocaleString()}` : 'Budget';
  }

  return pick.autoPicked ? 'Auto' : 'Manual';
}

export function Component() {
  const { draftId } = useParams<{ draftId: string }>();
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  const { data: draft, isLoading } = useQuery({
    queryKey: ['drafts', draftId, 'results'],
    queryFn: async () => {
      const { data, error } = await getDraftState({
        client,
        path: { contestId: draftId! },
      });
      if (error) throw error;
      return DraftStateResponseSchema.parse(data);
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading || !draft) {
    return <div className="space-y-6"><div className="h-8 w-64 rounded bg-muted animate-pulse" /></div>;
  }

  const copy = getResultsCopy(draft.selectionType);
  const selectionDetailRows = getSelectionConfigDetailRows(draft.selectionConfig);

  const picksByEntry = new Map<string, typeof draft.picks>();
  for (const pick of draft.picks) {
    const existing = picksByEntry.get(pick.entryId) ?? [];
    existing.push(pick);
    picksByEntry.set(pick.entryId, existing);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{draft.contestName} - {copy.titleSuffix}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {draft.totalPicks} {copy.itemLabel} across {draft.entries.length} entries
        </p>
        <p className="text-sm text-muted-foreground">
          {formatSelectionTypeLabel(draft.selectionType)}
        </p>
      </div>

      {!draft.isComplete && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            {copy.inProgress}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-lg">{copy.listTitle}</CardTitle></CardHeader>
        <CardContent>
          {draft.picks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No {copy.itemLabel} have been recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b">
                  <th className="text-left px-3 py-2 font-medium">#</th>
                  <th className="text-left px-3 py-2 font-medium">{copy.roundLabel}</th>
                  <th className="text-left px-3 py-2 font-medium">Entry</th>
                  <th className="text-left px-3 py-2 font-medium">{copy.participantLabel}</th>
                  <th className="text-left px-3 py-2 font-medium">{copy.contextLabel}</th>
                  <th className="text-left px-3 py-2 font-medium">Team</th>
                  <th className="text-left px-3 py-2 font-medium">{copy.typeLabel}</th>
                </tr></thead>
                <tbody>
                  {draft.picks.map((pick) => (
                    <tr key={`${pick.entryId}-${pick.pickNumber}`} className="border-b hover:bg-accent/50">
                      <td className="px-3 py-2 text-muted-foreground">{pick.pickNumber}</td>
                      <td className="px-3 py-2">{pick.round}</td>
                      <td className="px-3 py-2 font-medium">{pick.entryName}</td>
                      <td className="px-3 py-2">
                        <div>{pick.isSkipped ? 'Skipped' : pick.participantName}</div>
                        {!pick.isSkipped && getPickDetailLabel(draft, pick) ? (
                          <div className="text-xs text-muted-foreground">{getPickDetailLabel(draft, pick)}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {draft.selectionType === SelectionType.TIERED ? (
                          pick.tierName ?? formatPickContext(draft.selectionType, pick.round, pick.pickNumber, pick.pickInRound)
                        ) : pick.position ? (
                          <Badge variant="outline" className="text-xs">{pick.position}</Badge>
                        ) : (
                          formatPickContext(draft.selectionType, pick.round, pick.pickNumber, pick.pickInRound)
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{pick.team ?? '-'}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-xs">{getTypeBadgeLabel(draft, pick)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">{copy.rosterTitle}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {draft.entries.map((entry) => {
            const entryPicks = picksByEntry.get(entry.id) ?? [];
            return (
              <div key={entry.id} className="border rounded-md">
                <button
                  className="flex items-center justify-between w-full px-4 py-3 hover:bg-accent/50"
                  onClick={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
                >
                  <span className="font-medium text-sm">{entry.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{entryPicks.length} {copy.itemLabel}</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${expandedEntry === entry.id ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {expandedEntry === entry.id && (
                  <div className="px-4 pb-3 space-y-1">
                    {entryPicks.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No {copy.itemLabel} recorded yet.</p>
                    ) : (
                      entryPicks.map((pick) => (
                        <div key={`${pick.entryId}-${pick.pickNumber}`} className="flex items-center gap-3 text-sm py-1">
                          {draft.selectionType === SelectionType.TIERED ? (
                            <Badge variant="outline" className="text-[10px] justify-center">{pick.tierName ?? 'Tier'}</Badge>
                          ) : pick.position ? (
                            <Badge variant="outline" className="text-[10px] w-10 justify-center">{pick.position}</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] w-10 justify-center">-</Badge>
                          )}
                          <div className="min-w-0">
                            <div>{pick.isSkipped ? 'Skipped' : pick.participantName}</div>
                            {!pick.isSkipped && getPickDetailLabel(draft, pick) ? (
                              <div className="text-xs text-muted-foreground">{getPickDetailLabel(draft, pick)}</div>
                            ) : null}
                          </div>
                          <span className="text-muted-foreground">
                            {pick.isSkipped
                              ? 'Commissioner skip'
                              : draft.selectionType === SelectionType.BUDGET_PICK && typeof pick.price === 'number'
                                ? `$${pick.price.toLocaleString()}`
                                : pick.team ?? '-'}
                          </span>
                          <span className="text-xs text-muted-foreground ml-auto">
                            {formatPickContext(draft.selectionType, pick.round, pick.pickNumber, pick.pickInRound)}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">{copy.stateTitle}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Selection Type</span><span>{formatSelectionTypeLabel(draft.selectionType)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span>{formatDraftStatus(draft.status)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Current {copy.participantLabel}</span><span>{draft.currentPickNumber}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">{copy.roundLabel}</span><span>{draft.currentRound}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">On the Clock</span><span>{draft.currentEntryName ?? 'None'}</span></div>
          {selectionDetailRows.map((row) => (
            <div key={row.label} className="flex justify-between">
              <span className="text-muted-foreground">{row.label}</span>
              <span>{row.value}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
