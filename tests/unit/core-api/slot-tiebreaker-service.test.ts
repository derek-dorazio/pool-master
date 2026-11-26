import { BackgroundJobType, MatchStatus, ProviderSyncFindingKind, ProviderSyncFindingSeverity, type BackgroundJobRequest, type ProviderSyncFindingRaise } from '@poolmaster/shared/domain';
import type { SlotTiebreakerGame, SlotTiebreakerRepository, SlotTiebreakerState, SlotTiebreakerWrite } from '@poolmaster/shared/db';
import { SlotTiebreakerService } from '../../../packages/core-api/src/modules/events/slot-tiebreaker-service';
import { toSportEventSlotTiebreakerDto } from '../../../packages/core-api/src/mappers/slot-tiebreaker.mapper';
import { testDomainEvents } from '../../support/domain-events';
import { fakeLogger } from '../../support/fake-logger';
import { expectDefined } from '../../support/expect-defined';

// An event slot's tiebreaker game (#2048) over an in-memory slot store: the rule's runs, a root
// admin's choice and its refusals, and the view the Slots tab reads. Real Postgres is in
// tests/integration/core-api/slot-tiebreaker.integration.ts.

const EVENT_ID = 'event-1';
const NOW = new Date('2027-01-10T12:00:00.000Z');
const EARLY = new Date('2027-01-10T18:00:00.000Z');
const LATE = new Date('2027-01-12T01:15:00.000Z');
const PAST = new Date('2027-01-09T18:00:00.000Z');

function game(id: string, scheduledDate: Date | null, overrides: Partial<SlotTiebreakerGame> = {}): SlotTiebreakerGame {
  return { id, sportEventRoundMatchId: `match-${id}`, gameNumber: 1, scheduledDate, status: MatchStatus.SCHEDULED, moved: false, ...overrides };
}

function slot(overrides: Partial<SlotTiebreakerState> = {}): SlotTiebreakerState {
  return {
    sportEventSlotId: 'event-slot-1',
    seasonSlotId: 'season-slot-1',
    sportLeagueId: 'league-1',
    tiebreakerGameId: null,
    chosen: null,
    games: [game('g-1', EARLY), game('g-2', LATE)],
    ...overrides,
  };
}

function setup(slots: SlotTiebreakerState[]) {
  const saved: { writes: readonly SlotTiebreakerWrite[]; jobs: readonly BackgroundJobRequest[] }[] = [];
  const repository: SlotTiebreakerRepository = {
    findBySportEvent: jest.fn(async () => slots),
    saveTiebreakerGames: jest.fn(async (writes, jobs) => {
      saved.push({ writes, jobs });
    }),
  };
  const raise = jest.fn(async (_raises: readonly ProviderSyncFindingRaise[]) => undefined);
  const service = new SlotTiebreakerService({ slots: repository, findings: { raise }, domainEvents: testDomainEvents(), now: () => NOW, logger: fakeLogger() });
  return { service, saved, raise };
}

describe('SlotTiebreakerService.refresh', () => {
  it('names the latest start by the rule, writing it with the event\'s leaderboard rebuild', async () => {
    const { service, saved, raise } = setup([slot()]);

    expect(await service.refresh(EVENT_ID)).toEqual({ changedCount: 1, replacedCount: 0 });

    expect(saved[0]?.writes).toEqual([{ sportEventSlotId: 'event-slot-1', tiebreakerGameId: 'g-2', chosen: null }]);
    expect(saved[0]?.jobs.map((job) => job.type)).toEqual([BackgroundJobType.REBUILD_LEADERBOARDS]);
    expect(raise).toHaveBeenCalledWith([]);
  });

  it('writes nothing when the rule\'s game is already the slot\'s, when the slot\'s game has started, or when a root admin chose it', async () => {
    const { service, saved } = setup([
      slot({ tiebreakerGameId: 'g-2' }),
      slot({ sportEventSlotId: 'started', tiebreakerGameId: 'g-1', games: [game('g-1', PAST), game('g-2', LATE)] }),
      slot({ sportEventSlotId: 'chosen', tiebreakerGameId: 'g-1', chosen: { at: PAST, byUserId: 'admin-1' } }),
    ]);

    expect(await service.refresh(EVENT_ID)).toEqual({ changedCount: 0, replacedCount: 0 });
    expect(saved).toEqual([]);
  });

  it('replaces a cancelled game, though it had started, and a root admin\'s moved choice, clearing the choice and raising a finding for each', async () => {
    const { service, saved, raise } = setup([
      slot({ tiebreakerGameId: 'g-2', games: [game('g-1', PAST), game('g-2', PAST, { status: MatchStatus.CANCELLED })] }),
      slot({ sportEventSlotId: 'moved', tiebreakerGameId: 'g-2', chosen: { at: PAST, byUserId: 'admin-1' }, games: [game('g-1', EARLY), game('g-2', LATE, { moved: true })] }),
    ]);

    expect(await service.refresh(EVENT_ID)).toEqual({ changedCount: 2, replacedCount: 2 });

    expect(saved[0]?.writes.map((write) => [write.sportEventSlotId, write.tiebreakerGameId, write.chosen])).toEqual([['event-slot-1', 'g-1', null], ['moved', 'g-1', null]]);
    const replaced = { kind: ProviderSyncFindingKind.TIEBREAKER_GAME_REPLACED, severity: ProviderSyncFindingSeverity.WARNING, sportLeagueId: 'league-1', sportEventId: EVENT_ID };
    expect(raise.mock.calls[0]?.[0].map(({ kind, severity, sportLeagueId, sportEventId }) => ({ kind, severity, sportLeagueId, sportEventId }))).toEqual([replaced, replaced]);
  });

  it('clears the slot\'s game when its only game is cancelled and no other can be chosen', async () => {
    const { service, saved } = setup([slot({ tiebreakerGameId: 'g-1', games: [game('g-1', EARLY, { status: MatchStatus.CANCELLED })] })]);

    expect(await service.refresh(EVENT_ID)).toEqual({ changedCount: 1, replacedCount: 1 });
    expect(saved[0]?.writes).toEqual([{ sportEventSlotId: 'event-slot-1', tiebreakerGameId: null, chosen: null }]);
  });
});

describe('SlotTiebreakerService.chooseTiebreakerGame', () => {
  it('keeps a root admin\'s choice with who made it and when, and answers the slot as the dialog reads it', async () => {
    const { service, saved } = setup([slot({ tiebreakerGameId: 'g-2' })]);

    const view = await service.chooseTiebreakerGame(EVENT_ID, 'season-slot-1', 'g-1', 'admin-1');

    expect(saved[0]?.writes).toEqual([{ sportEventSlotId: 'event-slot-1', tiebreakerGameId: 'g-1', chosen: { at: NOW, byUserId: 'admin-1' } }]);
    expect(view).toMatchObject({ tiebreakerGameId: 'g-1', chosen: { at: NOW, byUserId: 'admin-1' }, editable: true });
  });

  it('refuses a slot the event does not cover, a game of another slot, a cancelled, moved or unscheduled game, and a change once either game has started', async () => {
    const { service } = setup([
      slot({ games: [game('g-1', EARLY), game('g-off', EARLY, { status: MatchStatus.CANCELLED }), game('g-moved', EARLY, { moved: true }), game('g-none', null), game('g-past', PAST)] }),
      slot({ sportEventSlotId: 'locked', seasonSlotId: 'season-slot-2', tiebreakerGameId: 'g-past', games: [game('g-past', PAST), game('g-1', EARLY)] }),
    ]);
    const choose = (seasonSlotId: string, gameId: string) => service.chooseTiebreakerGame(EVENT_ID, seasonSlotId, gameId, 'admin-1');

    await expect(choose('season-slot-9', 'g-1')).rejects.toMatchObject({ code: 'SEASON_SLOT_NOT_FOUND', statusCode: 404 });
    await expect(choose('season-slot-1', 'g-elsewhere')).rejects.toMatchObject({ code: 'TIEBREAKER_GAME_NOT_IN_SLOT', statusCode: 422 });
    for (const gameId of ['g-off', 'g-moved', 'g-none']) {
      await expect(choose('season-slot-1', gameId)).rejects.toMatchObject({ code: 'TIEBREAKER_GAME_NOT_ELIGIBLE', statusCode: 422 });
    }
    await expect(choose('season-slot-1', 'g-past')).rejects.toMatchObject({ code: 'TIEBREAKER_GAME_STARTED', statusCode: 409 });
    await expect(choose('season-slot-2', 'g-1')).rejects.toMatchObject({ code: 'TIEBREAKER_GAME_STARTED', statusCode: 409 });
  });
});

describe('SlotTiebreakerService.listSlotTiebreakers, as the mapper sends it', () => {
  it('offers each game the rule could choose that has not started, while the slot\'s game has not started', async () => {
    const { service } = setup([slot({ tiebreakerGameId: 'g-2', games: [game('g-1', EARLY), game('g-2', LATE), game('g-past', PAST), game('g-off', EARLY, { status: MatchStatus.CANCELLED })] })]);

    const dto = expectDefined((await service.listSlotTiebreakers(EVENT_ID)).map(toSportEventSlotTiebreakerDto)[0]);

    expect(dto).toMatchObject({ seasonSlotId: 'season-slot-1', tiebreakerGameId: 'g-2', chosenAt: null, chosenByUserId: null, editable: true });
    expect(dto.games.map((each) => [each.id, each.choosable])).toEqual([['g-1', true], ['g-2', true], ['g-past', false], ['g-off', false]]);
    expect(dto.games[0]).toMatchObject({ scheduledDate: EARLY.toISOString(), sportEventRoundMatchId: 'match-g-1', gameNumber: 1, moved: false });
  });

  it('offers nothing once the slot\'s game has started, and names who chose it and when', async () => {
    const { service } = setup([slot({ tiebreakerGameId: 'g-past', chosen: { at: PAST, byUserId: 'admin-1' }, games: [game('g-past', PAST), game('g-none', null)] })]);

    const dto = expectDefined((await service.listSlotTiebreakers(EVENT_ID)).map(toSportEventSlotTiebreakerDto)[0]);

    expect(dto).toMatchObject({ editable: false, chosenAt: PAST.toISOString(), chosenByUserId: 'admin-1' });
    expect(dto.games.map((each) => [each.choosable, each.scheduledDate])).toEqual([[false, PAST.toISOString()], [false, null]]);
  });
});
