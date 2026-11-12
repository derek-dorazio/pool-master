import { describe, expect, it } from 'vitest';
import type { GamePickPreviewResponse } from '@/lib/api';
import type { SelectionGroup } from './contest-entry-selection';
import {
  nextTrialIds,
  pickPreviewUnavailableReason,
  previewConfidence,
  previewRulesFor,
  previewTeamPick,
  previewTiePick,
  toPreviewWeek,
} from './pick-preview';

const golfer = { one: 'golfer', many: 'golfers' };

function group(groupId: string, ids: string[], selected: string[], picksFromGroup = 1): SelectionGroup {
  return {
    groupId,
    groupName: groupId,
    groupNumber: 1,
    picksFromGroup,
    selectedParticipantIds: selected,
    participants: ids.map((id) => ({
      sportEventParticipantId: id,
      participantId: `p-${id}`,
      participantName: id,
      seedNumber: null,
      isAvailable: true,
      isSelected: selected.includes(id),
    })),
  };
}

type PreviewGame = GamePickPreviewResponse['games'][number];
const bills = { sportEventParticipantId: 'sep-bills', participantId: 'p-bills', name: 'Bills' };
const chiefs = { sportEventParticipantId: 'sep-chiefs', participantId: 'p-chiefs', name: 'Chiefs' };

function previewGame(matchNumber: number, pick: PreviewGame['pick'] = null): PreviewGame {
  return {
    sportEventMatchId: `match-${matchNumber}`,
    matchNumber,
    roundNumber: 1,
    kickoff: '2099-09-13T17:00:00.000Z',
    status: 'SCHEDULED',
    isNeutralSite: false,
    regionLabel: null,
    homeSpread: null,
    home: chiefs,
    away: bills,
    predictedHome: chiefs,
    predictedAway: bills,
    locked: false,
    pick,
  };
}

function preview(overrides: Partial<GamePickPreviewResponse> = {}): GamePickPreviewResponse {
  return {
    sportEventId: 'event-1',
    selectionType: 'PICK_EM',
    mode: 'STRAIGHT_UP',
    againstTheSpread: false,
    tiePicksOffered: false,
    pickedCount: 0,
    gameCount: 2,
    tiebreakerMatchId: 'match-2',
    games: [previewGame(1), previewGame(2)],
    ...overrides,
  };
}

const teamPickOf = (team: typeof bills, confidence?: number | null) => ({
  predictedResult: 'TEAM' as const,
  sportEventParticipantId: team.sportEventParticipantId,
  confidence: confidence ?? null,
});

describe('previewRulesFor', () => {
  it('sends a tiered setup\'s pick rules without its entry limit, keeping the tiers used', () => {
    expect(previewRulesFor({ selectionType: 'TIERED', picksPerTier: 2, countedScores: 4, tiersUsed: 3, maxEntriesPerSquad: 2 })).toEqual({
      kind: 'roster',
      rules: { selectionType: 'TIERED', picksPerTier: 2, countedScores: 4, tiersUsed: 3 },
    });
  });

  it('sends a budget setup as a roster preview and pick\'em, bracket and survivor as game previews', () => {
    expect(previewRulesFor({ selectionType: 'BUDGET_PICK', rosterSize: 6, countedScores: 4 })?.kind).toBe('roster');
    expect(previewRulesFor({ selectionType: 'PICK_EM', mode: 'CONFIDENCE', againstTheSpread: true })).toEqual({
      kind: 'games',
      rules: { selectionType: 'PICK_EM', mode: 'CONFIDENCE', againstTheSpread: true },
    });
    expect(previewRulesFor({ selectionType: 'BRACKET', startsAtRound: 3 })).toEqual({
      kind: 'games',
      rules: { selectionType: 'BRACKET', startsAtRound: 3 },
    });
    expect(previewRulesFor({ selectionType: 'SURVIVOR', reuseTeamsOnceAllUsed: false })).toEqual({
      kind: 'games',
      rules: { selectionType: 'SURVIVOR', reuseTeamsOnceAllUsed: false },
    });
  });

  it('has no preview for a random draw or squares, which have no picks page', () => {
    expect(previewRulesFor({ selectionType: 'RANDOM_DRAW', picksPerEntry: 4, countedScores: 4 })).toBeNull();
    expect(previewRulesFor({ selectionType: 'SQUARES', maxSquaresPerEntry: 10 })).toBeNull();
  });
});

describe('pickPreviewUnavailableReason', () => {
  const ready = { loadedParticipantCount: 90, pricing: null };
  const reason = (overrides: Partial<Parameters<typeof pickPreviewUnavailableReason>[0]>) => pickPreviewUnavailableReason({
    event: ready,
    participant: golfer,
    rulesError: null,
    selectionType: 'TIERED',
    tierCount: 6,
    ...overrides,
  });

  it('lets a setup with a loaded field, readable rules and tiers open the preview', () => {
    expect(reason({})).toBeNull();
  });

  it('turns the preview off for a random draw and squares, saying why', () => {
    expect(reason({ selectionType: 'RANDOM_DRAW' })).toContain('random draw');
    expect(reason({ selectionType: 'SQUARES' })).toContain('no picks page');
  });

  it('turns the preview off until an event is chosen and the rules read', () => {
    expect(reason({ event: null })).toBe('Choose an event to preview its picks page.');
    expect(reason({ rulesError: 'Picks per tier must be at least 1.' })).toBe('Finish the rules to preview the picks page.');
  });

  it('turns the preview off while the field is not loaded, the tiers are not set, or a budget field is not priced', () => {
    expect(reason({ event: { loadedParticipantCount: 0, pricing: null } })).toBe('This event\'s golfers aren\'t loaded yet, so there is nothing to pick from.');
    expect(reason({ tierCount: 0 })).toContain('tiers aren\'t set yet');
    expect(reason({ selectionType: 'BUDGET_PICK' })).toBe('This event\'s golfers aren\'t priced yet.');
  });
});

describe('toPreviewWeek', () => {
  it('draws a setup\'s week as the commissioner\'s own unscored trial with the tiebreaker as typed', () => {
    const week = toPreviewWeek(preview({ games: [previewGame(1, { ...teamPickOf(bills) }), previewGame(2)] }), 41);

    expect(week.ownEntry).toBe(true);
    expect(week.survivor).toBeNull();
    expect(week.tiebreakerValue).toBe(41);
    expect(week.games[0]?.revealed).toBe(false);
    expect(week.games[0]?.pick).toEqual({ ...teamPickOf(bills), outcome: null, points: null });
    expect(week.games[1]?.pick).toBeNull();
  });
});

describe('trial game picks', () => {
  it('replaces the tapped game\'s pick and keeps the others that stand', () => {
    const week = toPreviewWeek(preview({ games: [previewGame(1, teamPickOf(bills)), previewGame(2, teamPickOf(chiefs))] }), null);

    expect(previewTeamPick(week, week.games[0], chiefs)).toEqual([
      { sportEventMatchId: 'match-2', predictedResult: 'TEAM', sportEventParticipantId: 'sep-chiefs' },
      { sportEventMatchId: 'match-1', predictedResult: 'TEAM', sportEventParticipantId: 'sep-chiefs' },
    ]);
  });

  it('builds on the picks that still stand, so a bracket pick the server dropped stays dropped', () => {
    // Game 2's earlier pick no longer stands: the answer shows it with none.
    const week = toPreviewWeek(preview({ selectionType: 'BRACKET', mode: null, games: [previewGame(1, teamPickOf(bills)), previewGame(2)] }), null);

    expect(previewTeamPick(week, week.games[0], chiefs)).toEqual([
      { sportEventMatchId: 'match-1', predictedResult: 'TEAM', sportEventParticipantId: 'sep-chiefs' },
    ]);
  });

  it('keeps only the one new pick in a survivor week', () => {
    const week = toPreviewWeek(preview({ selectionType: 'SURVIVOR', mode: null, games: [previewGame(1, teamPickOf(bills)), previewGame(2)] }), null);

    expect(previewTeamPick(week, week.games[1], chiefs)).toEqual([
      { sportEventMatchId: 'match-2', predictedResult: 'TEAM', sportEventParticipantId: 'sep-chiefs' },
    ]);
  });

  it('picks a tie, and swaps a confidence value with the game that held it', () => {
    const week = toPreviewWeek(preview({
      mode: 'CONFIDENCE',
      tiePicksOffered: true,
      games: [previewGame(1, teamPickOf(bills, 2)), previewGame(2, teamPickOf(chiefs, 1))],
    }), null);

    expect(previewTiePick(week, week.games[0])).toContainEqual(
      { sportEventMatchId: 'match-1', predictedResult: 'TIE', sportEventParticipantId: null, confidence: 2 },
    );
    expect(previewConfidence(week, week.games[0], 1)).toEqual([
      { sportEventMatchId: 'match-1', ...teamPickOf(bills, 1) },
      { sportEventMatchId: 'match-2', ...teamPickOf(chiefs, 2) },
    ]);
  });
});

describe('nextTrialIds', () => {
  it('adds a tapped golfer and drops a held one, in tap order', () => {
    const tier = group('tier-1', ['a', 'b', 'c'], ['a'], 2);

    expect(nextTrialIds({ selectionType: 'TIERED' }, tier, 'b', ['x', 'a'])).toEqual(['x', 'a', 'b']);
    expect(nextTrialIds({ selectionType: 'TIERED' }, tier, 'a', ['x', 'a'])).toEqual(['x']);
  });

  it('swaps the newest pick out of a full tier, as an entry\'s tap does', () => {
    const tier = group('tier-1', ['a', 'b', 'c'], ['a', 'b'], 2);

    expect(nextTrialIds({ selectionType: 'TIERED' }, tier, 'c', ['b', 'a'])).toEqual(['b', 'c']);
  });

  it('takes no one new onto a full budget roster', () => {
    const field = group('field', ['a', 'b', 'c'], ['a', 'b'], 2);

    expect(nextTrialIds({ selectionType: 'BUDGET_PICK' }, field, 'c', ['a', 'b'])).toEqual(['a', 'b']);
  });
});
