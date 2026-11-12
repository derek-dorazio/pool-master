/**
 * #1612 — the pick preview handlers: the unsaved setup and trial picks off the body go to the
 * services as they are, and each preview answers its published shape.
 */
import { expect } from '@jest/globals';
import { MatchStatus, PickEmMode, PredictedResult, SelectionType, type SportEventMatch } from '@poolmaster/shared/domain';
import { GamePickPreviewResponseSchema, RosterPickPreviewResponseSchema } from '@poolmaster/shared/dto';
import { createPickPreviewHandlers } from '../../../packages/core-api/src/modules/selections/preview-handler';
import type { GamesPreview, PredictionService } from '../../../packages/core-api/src/modules/selections/prediction-service';
import type { SelectionService } from '../../../packages/core-api/src/modules/selections/service';
import type { LineupPreview } from '../../../packages/core-api/src/modules/selections/types';
import { callHandler, stubRequest } from '../../support/handler-call';

const EVENT = '00000000-0000-4000-8000-000000000001';
const GAME = '00000000-0000-4000-8000-000000000002';
const HOME = '00000000-0000-4000-8000-000000000003';
const AWAY = '00000000-0000-4000-8000-000000000004';
const KICKOFF = new Date('2099-09-10T20:00:00.000Z');

const team = (id: string) => ({ sportEventParticipantId: id, participantId: id, name: `Team ${id.slice(-1)}` });

const LINEUP: LineupPreview = {
  sportEventId: EVENT,
  selectionType: SelectionType.TIERED,
  rosterSize: 1,
  selectionGroups: [{
    groupId: 'tier-1',
    groupName: 'Tier 1',
    groupNumber: 1,
    picksFromGroup: 1,
    selectedParticipantIds: [],
    participants: [{
      sportEventParticipantId: HOME, participantId: HOME, participantName: 'Golfer', isAvailable: true, isSelected: true, seedNumber: null,
    }],
  }],
  availableSportEventParticipantIds: [HOME],
  pickCount: 1,
  isComplete: true,
  lineupSummary: null,
};

function gamesPreview(withPick: boolean): GamesPreview {
  return {
    sportEventId: EVENT,
    selectionType: SelectionType.PICK_EM,
    mode: PickEmMode.STRAIGHT_UP,
    againstTheSpread: false,
    tiePicksOffered: false,
    pickedCount: withPick ? 1 : 0,
    gameCount: 1,
    tiebreakerMatchId: GAME,
    games: [{
      match: { id: GAME, matchNumber: 1, roundNumber: 1, status: MatchStatus.SCHEDULED, isNeutralSite: false, regionLabel: null, homeSpread: null } as SportEventMatch,
      kickoff: KICKOFF,
      home: team(HOME),
      away: team(AWAY),
      predictedHome: team(HOME),
      predictedAway: team(AWAY),
      locked: false,
      pick: withPick ? { sportEventMatchId: GAME, predictedResult: PredictedResult.TEAM, sportEventParticipantId: AWAY, confidence: null } : null,
    }],
  };
}

function setup(games: GamesPreview) {
  const selections = { previewLineup: jest.fn((..._args: unknown[]) => Promise.resolve(LINEUP)) };
  const predictions = { previewGames: jest.fn((..._args: unknown[]) => Promise.resolve(games)) };
  const handlers = createPickPreviewHandlers(selections as unknown as SelectionService, predictions as unknown as PredictionService);
  return { selections, predictions, handlers };
}

describe('pick preview handlers', () => {
  it('hands the roster setup and its trial picks to the room\'s preview and answers RosterPickPreviewResponse', async () => {
    const { selections, handlers } = setup(gamesPreview(false));
    const rules = { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 1 };

    const reply = await callHandler(handlers.previewRosterPicks, stubRequest({
      params: { id: 'league-1' },
      body: { sportEventId: EVENT, rules, sportEventParticipantIds: [HOME] },
    }));

    expect(selections.previewLineup.mock.calls).toEqual([[{ sportEventId: EVENT, rules, sportEventParticipantIds: [HOME] }]]);
    expect(RosterPickPreviewResponseSchema.parse(reply.body)).toMatchObject({ rosterSize: 1, pickCount: 1, isComplete: true });
  });

  it('reads the game setup\'s trial picks, an omitted confidence as none, and answers each game with the pick that stands', async () => {
    const { predictions, handlers } = setup(gamesPreview(true));
    const rules = { selectionType: SelectionType.PICK_EM, mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false };

    const reply = await callHandler(handlers.previewGamePicks, stubRequest({
      params: { id: 'league-1' },
      body: { sportEventId: EVENT, rules, picks: [{ sportEventMatchId: GAME, predictedResult: PredictedResult.TEAM, sportEventParticipantId: AWAY }] },
    }));

    expect(predictions.previewGames.mock.calls).toEqual([[{
      sportEventId: EVENT,
      rules,
      picks: [{ sportEventMatchId: GAME, predictedResult: PredictedResult.TEAM, sportEventParticipantId: AWAY, confidence: null }],
    }]]);
    const body = GamePickPreviewResponseSchema.parse(reply.body);
    expect(body.games[0]).toMatchObject({ kickoff: KICKOFF.toISOString(), locked: false, pick: { sportEventParticipantId: AWAY, confidence: null } });
  });

  it('answers a game with no trial pick with none', async () => {
    const { handlers } = setup(gamesPreview(false));

    const reply = await callHandler(handlers.previewGamePicks, stubRequest({
      params: { id: 'league-1' },
      body: { sportEventId: EVENT, rules: { selectionType: SelectionType.SURVIVOR }, picks: [] },
    }));

    expect(GamePickPreviewResponseSchema.parse(reply.body).games[0]?.pick).toBeNull();
  });
});
