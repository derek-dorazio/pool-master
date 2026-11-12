import { ParticipantRoundStatus, ProviderGameState, ScoringFamily, Sport, SportStat } from '@poolmaster/shared/domain';
import type { StatLineGameUpdate } from '@poolmaster/shared/dto';
import { writeStatLineGames, type StatLineWriterDeps } from '../../../packages/core-api/src/modules/scoring-families/composite/stat-line-writer';
import { StatLineService } from '../../../packages/core-api/src/modules/scoring-families/composite/stat-line-service';
import { fakeLogger } from '../../support/fake-logger';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';

// A provider's box scores written into a Clutch Card event's stat lines (#1497), through the
// real StatLineService over an in-memory store. Stars Ace and Bat are in the field and mapped to
// provider players `bdl-ace` and `bdl-bat`; `bdl-bench` played but is no star.

const PROVIDER = 'balldontlie';
const NOW = new Date('2026-06-10T03:00:00.000Z');

async function setup(options: { rounds?: number | null } = {}) {
  const store = new InMemorySportEvents();
  const sportRow = store.addSport(Sport.BASKETBALL);
  const event = store.addEvent({ sport: Sport.BASKETBALL, name: 'NBA Finals', scoringFamily: ScoringFamily.COMPOSITE });
  await store.addRounds(event.id, [1, 2, 3].map((roundNumber) => ({ roundNumber, scheduledDate: new Date(`2026-06-0${roundNumber}T00:00:00.000Z`) })));
  const ace = store.addToField(event.id, store.addParticipant(sportRow.id, 'Ace').id);
  const bat = store.addToField(event.id, store.addParticipant(sportRow.id, 'Bat').id);
  const outsider = store.addParticipant(sportRow.id, 'Outsider');
  const mappings = store.mappingRepo();
  await mappings.bind({ participantId: ace.participantId, providerId: PROVIDER, externalId: 'bdl-ace', confidence: 'EXACT', mappedAt: NOW });
  await mappings.bind({ participantId: bat.participantId, providerId: PROVIDER, externalId: 'bdl-bat', confidence: 'EXACT', mappedAt: NOW });
  // Mapped, but not one of this event's stars.
  await mappings.bind({ participantId: outsider.id, providerId: PROVIDER, externalId: 'bdl-outsider', confidence: 'EXACT', mappedAt: NOW });
  const logger = fakeLogger();
  const statLines = new StatLineService({
    events: store.sportEventRepo(), rounds: store.roundRepo(), field: store.fieldRepo(), statLines: store.statLineRepo(), now: () => NOW,
  });
  const deps: StatLineWriterDeps = { providerId: PROVIDER, field: store.fieldRepo(), mappings, statLines, logger };
  const target = { id: event.id, rounds: options.rounds === undefined ? 3 : options.rounds, roundSeriesLengths: [] };
  return { store, deps, target, ace, bat, logger, statLines };
}

function boxScore(gameNumber: number, state: ProviderGameState, lines: Record<string, number>, externalGameId = `g${gameNumber}`): StatLineGameUpdate {
  return {
    externalGameId,
    gameNumber,
    state,
    lines: Object.entries(lines).map(([player, points]) => ({ participantExternalId: player, stats: [{ stat: SportStat.POINTS, value: points }] })),
  };
}

/** Each stored line as [player name, game, status, points]. */
function storedLines(store: InMemorySportEvents) {
  return store.participantRoundRows.map((row) => {
    const entry = store.field.find((candidate) => candidate.id === row.sportEventParticipantId);
    const name = store.participants.find((participant) => participant.id === entry?.participantId)?.name;
    const points = store.statLineRows.find((line) => line.participantRoundId === row.id)?.value;
    return [name, store.roundNumberOf(row.sportEventRoundId), row.status, points];
  });
}

describe('writeStatLineGames — what it stores', () => {
  it('stores a final game\'s lines for the event\'s stars as completed, and reports each line created', async () => {
    const { store, deps, target, ace } = await setup();

    const result = await writeStatLineGames(deps, target, [boxScore(1, ProviderGameState.FINAL, { 'bdl-ace': 31, 'bdl-bat': 12 })]);

    expect(storedLines(store)).toEqual([['Ace', 1, ParticipantRoundStatus.COMPLETED, 31], ['Bat', 1, ParticipantRoundStatus.COMPLETED, 12]]);
    expect(result).toMatchObject({ updatesReturned: 1, updatesPersisted: 1, updatesSkipped: 0 });
    expect(result.writeDiagnostics.summary).toMatchObject({ total: 2, created: 2 });
    expect(result.writeDiagnostics.rows[0]).toMatchObject({
      entityType: 'SportEventParticipantRound', disposition: 'CREATED', providerId: PROVIDER, externalId: 'g1',
      participantExternalId: 'bdl-ace', internalId: ace.id, name: 'Game 1',
    });
  });

  it('stores a live game\'s lines in progress, and completes them when the provider calls the game final', async () => {
    const { store, deps, target } = await setup();

    await writeStatLineGames(deps, target, [boxScore(2, ProviderGameState.IN_PROGRESS, { 'bdl-ace': 10 })]);
    const during = storedLines(store);
    const result = await writeStatLineGames(deps, target, [boxScore(2, ProviderGameState.FINAL, { 'bdl-ace': 28 })]);

    expect(during).toEqual([['Ace', 2, ParticipantRoundStatus.IN_PROGRESS, 10]]);
    expect(storedLines(store)).toEqual([['Ace', 2, ParticipantRoundStatus.COMPLETED, 28]]);
    expect(result.writeDiagnostics.summary).toMatchObject({ updated: 1 });
  });

  it('puts two series\' Game N on the event\'s game N, naming both provider games on its lines', async () => {
    const { store, deps, target } = await setup();

    const result = await writeStatLineGames(deps, target, [
      boxScore(1, ProviderGameState.FINAL, { 'bdl-ace': 20 }, 'east-1'),
      boxScore(1, ProviderGameState.IN_PROGRESS, { 'bdl-bat': 9 }, 'west-1'),
    ]);

    expect(storedLines(store)).toEqual([['Ace', 1, ParticipantRoundStatus.COMPLETED, 20], ['Bat', 1, ParticipantRoundStatus.IN_PROGRESS, 9]]);
    expect(result.writeDiagnostics.rows.map((row) => row.externalId)).toEqual(['east-1,west-1', 'east-1,west-1']);
    expect(result).toMatchObject({ updatesReturned: 2, updatesPersisted: 2, updatesSkipped: 0 });
  });

  it('counts a repeated sync of the same box score as unchanged and not persisted', async () => {
    const { deps, target } = await setup();
    const games = [boxScore(1, ProviderGameState.FINAL, { 'bdl-ace': 31 })];
    await writeStatLineGames(deps, target, games);

    const result = await writeStatLineGames(deps, target, games);

    expect(result).toMatchObject({ updatesReturned: 1, updatesPersisted: 0, updatesSkipped: 1 });
    expect(result.writeDiagnostics.summary).toMatchObject({ total: 1, unchanged: 1 });
  });

  it('accepts a game numbered within an event whose game count is not set', async () => {
    const { store, deps, target } = await setup({ rounds: null });

    await writeStatLineGames(deps, target, [boxScore(3, ProviderGameState.FINAL, { 'bdl-ace': 5 })]);

    expect(storedLines(store)).toEqual([['Ace', 3, ParticipantRoundStatus.COMPLETED, 5]]);
  });
});

describe('writeStatLineGames — what it leaves out', () => {
  it('leaves out an unmapped player and a mapped player who is not a star, logging how many, and stores the stars\' lines', async () => {
    const { store, deps, target, logger } = await setup();

    await writeStatLineGames(deps, target, [boxScore(1, ProviderGameState.FINAL, { 'bdl-ace': 31, 'bdl-bench': 4, 'bdl-outsider': 7 })]);

    expect(storedLines(store)).toEqual([['Ace', 1, ParticipantRoundStatus.COMPLETED, 31]]);
    expect(logger.info).toHaveBeenCalledWith(
      { action: 'liveScore.statLines.playersNotInField', data: { sportEventId: target.id, players: 2 } },
      expect.any(String),
    );
  });

  it.each([ProviderGameState.SCHEDULED, ProviderGameState.POSTPONED, ProviderGameState.CANCELLED])(
    'writes nothing for a %s game and keeps the stored line, reading nothing',
    async (state) => {
      const { store, deps, target } = await setup();
      await writeStatLineGames(deps, target, [boxScore(1, ProviderGameState.FINAL, { 'bdl-ace': 31 })]);
      const findBySportEvent = jest.spyOn(deps.field, 'findBySportEvent');

      const result = await writeStatLineGames(deps, target, [boxScore(1, state, { 'bdl-ace': 0 })]);

      expect(storedLines(store)).toEqual([['Ace', 1, ParticipantRoundStatus.COMPLETED, 31]]);
      expect(findBySportEvent).not.toHaveBeenCalled();
      expect(result).toMatchObject({ updatesReturned: 1, updatesPersisted: 0, updatesSkipped: 1 });
      expect(result.writeDiagnostics.summary.total).toBe(0);
    },
  );

  it('leaves out a game numbered past the event\'s games, logging it, and stores the rest', async () => {
    const { store, deps, target, logger } = await setup();

    const result = await writeStatLineGames(deps, target, [
      boxScore(1, ProviderGameState.FINAL, { 'bdl-ace': 31 }),
      boxScore(4, ProviderGameState.FINAL, { 'bdl-ace': 22 }),
    ]);

    expect(storedLines(store)).toEqual([['Ace', 1, ParticipantRoundStatus.COMPLETED, 31]]);
    expect(result).toMatchObject({ updatesReturned: 2, updatesPersisted: 1, updatesSkipped: 1 });
    expect(logger.warn).toHaveBeenCalledWith(
      { action: 'liveScore.statLines.gameBeyondSchedule', data: { sportEventId: target.id, externalGameId: 'g4', gameNumber: 4, rounds: 3 } },
      expect.any(String),
    );
  });

  it('writes nothing when no line in the batch belongs to a star', async () => {
    const { store, deps, target } = await setup();

    const result = await writeStatLineGames(deps, target, [boxScore(1, ProviderGameState.FINAL, { 'bdl-bench': 4 })]);

    expect(store.participantRoundRows).toEqual([]);
    expect(result).toMatchObject({ updatesReturned: 1, updatesPersisted: 0, updatesSkipped: 1 });
  });

  it('logs a batch the event refuses and writes none of it, so the next sync tries again', async () => {
    const { store, deps, target, logger } = await setup();
    const doubled: StatLineGameUpdate = {
      externalGameId: 'g1', gameNumber: 1, state: ProviderGameState.FINAL,
      lines: [{ participantExternalId: 'bdl-ace', stats: [{ stat: SportStat.POINTS, value: 1 }, { stat: SportStat.POINTS, value: 2 }] }],
    };

    const result = await writeStatLineGames(deps, target, [doubled, boxScore(2, ProviderGameState.FINAL, { 'bdl-bat': 3 })]);

    expect(store.participantRoundRows).toEqual([]);
    expect(result).toMatchObject({ updatesReturned: 2, updatesPersisted: 0, updatesSkipped: 2 });
    const [refused] = logger.warn.mock.calls.map(([entry]) => entry as { action: string; data: { sportEventId: string; code: string; message: string } });
    expect([refused.action, refused.data.sportEventId, refused.data.code]).toEqual(['liveScore.statLines.refused', target.id, 'STAT_LINE_ROWS_INVALID']);
    expect(refused.data.message).toContain('POINTS is given more than once');
  });

  it('lets an unexpected failure through rather than reporting nothing written', async () => {
    const { deps, target, statLines } = await setup();
    jest.spyOn(statLines, 'applyGames').mockRejectedValue(new Error('database is down'));

    await expect(writeStatLineGames(deps, target, [boxScore(1, ProviderGameState.FINAL, { 'bdl-ace': 31 })])).rejects.toThrow('database is down');
  });
});
