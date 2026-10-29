import { dailyRoundSchedule, SportEventRoundService } from '../../../packages/core-api/src/modules/events/sport-event-round-service';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';

// The round schedule's rules against an in-memory store: the default is sequential days, new
// events' schedules are written together, and rescheduling only ever moves rounds that exist.

function setup() {
  const store = new InMemorySportEvents();
  const event = store.addEvent();
  return { store, event, service: new SportEventRoundService({ rounds: store.roundRepo() }) };
}

const START = new Date('2026-06-04T12:00:00.000Z');

describe('SportEventRoundService', () => {
  it('schedules rounds a day apart from the start by default', () => {
    expect(dailyRoundSchedule(3, START).map((round) => [round.roundNumber, round.scheduledDate.toISOString()])).toEqual([
      [1, '2026-06-04T12:00:00.000Z'],
      [2, '2026-06-05T12:00:00.000Z'],
      [3, '2026-06-06T12:00:00.000Z'],
    ]);
  });

  it('creates several new events\' schedules as given, each on its own event', async () => {
    const { store, event, service } = setup();
    const other = store.addEvent();

    await service.createSchedules([
      { sportEventId: event.id, rounds: [{ roundNumber: 1, scheduledDate: START, scheduledEndAt: new Date('2026-06-04T20:00:00.000Z') }] },
      { sportEventId: other.id, rounds: dailyRoundSchedule(2, START) },
    ]);

    expect(await service.listRounds(event.id)).toEqual([expect.objectContaining({ roundNumber: 1, scheduledEndAt: new Date('2026-06-04T20:00:00.000Z') })]);
    expect((await service.listRounds(other.id)).map((round) => round.roundNumber)).toEqual([1, 2]);
  });

  it('reschedules existing rounds, clearing an end set to null and keeping one left out', async () => {
    const { store, event, service } = setup();
    await store.addRounds(event.id, [
      { roundNumber: 1, scheduledDate: START, scheduledEndAt: new Date('2026-06-04T20:00:00.000Z') },
      { roundNumber: 2, scheduledDate: START, scheduledEndAt: new Date('2026-06-05T20:00:00.000Z') },
    ]);

    const rounds = await service.reschedule(event.id, [
      { roundNumber: 1, scheduledDate: new Date('2026-06-06T12:00:00.000Z'), scheduledEndAt: null },
      { roundNumber: 2, scheduledDate: new Date('2026-06-07T12:00:00.000Z') },
    ]);

    expect(rounds.map((round) => [round.scheduledDate.toISOString().slice(0, 10), round.scheduledEndAt])).toEqual([
      ['2026-06-06', null],
      ['2026-06-07', new Date('2026-06-05T20:00:00.000Z')],
    ]);
  });

  it('refuses to reschedule a round the event lacks with 404 ROUND_NOT_FOUND, creating nothing', async () => {
    const { store, event, service } = setup();

    await expect(service.reschedule(event.id, [{ roundNumber: 5, scheduledDate: START }]))
      .rejects.toMatchObject({ code: 'ROUND_NOT_FOUND', statusCode: 404 });
    expect(store.roundRows).toEqual([]);
  });
});

describe('SportEventRoundService.shiftSchedule', () => {
  it('moves every round\'s start and end by the same amount, keeping an unset end unset', async () => {
    const { store, event, service } = setup();
    await store.addRounds(event.id, [
      { roundNumber: 1, scheduledDate: START, scheduledEndAt: new Date('2026-06-04T20:00:00.000Z') },
      { roundNumber: 2, scheduledDate: new Date('2026-06-05T12:00:00.000Z'), scheduledEndAt: null },
    ]);

    await service.shiftSchedule(event.id, 2 * 24 * 60 * 60 * 1000);

    const rounds = await service.listRounds(event.id);
    expect(rounds.map((round) => [round.roundNumber, round.scheduledDate.toISOString(), round.scheduledEndAt?.toISOString() ?? null])).toEqual([
      [1, '2026-06-06T12:00:00.000Z', '2026-06-06T20:00:00.000Z'],
      [2, '2026-06-07T12:00:00.000Z', null],
    ]);
  });

  it('does nothing for an event with no rounds, creating none', async () => {
    const { store, event, service } = setup();

    await expect(service.shiftSchedule(event.id, 60_000)).resolves.toEqual([]);
    expect(store.roundRows).toHaveLength(0);
  });
});

describe('SportEventRoundService.extendTo', () => {
  it('adds each missing round a day after the round before it, following an irregular schedule', async () => {
    const { store, event, service } = setup();
    await store.addRounds(event.id, [
      { roundNumber: 1, scheduledDate: START },
      { roundNumber: 2, scheduledDate: new Date('2026-06-06T12:00:00.000Z') },
    ]);

    const rounds = await service.extendTo({ sportEventId: event.id, rounds: 4, startDate: START });

    expect(rounds.map((round) => [round.roundNumber, round.scheduledDate.toISOString().slice(0, 10)])).toEqual([
      [1, '2026-06-04'],
      [2, '2026-06-06'],
      [3, '2026-06-07'],
      [4, '2026-06-08'],
    ]);
  });

  it('schedules from the start date when the event has no rounds, and adds nothing when every round exists', async () => {
    const { store, event, service } = setup();

    await service.extendTo({ sportEventId: event.id, rounds: 2, startDate: START });
    await service.extendTo({ sportEventId: event.id, rounds: 2, startDate: new Date('2030-01-01T00:00:00.000Z') });

    expect(store.roundRows.map((round) => round.scheduledDate.toISOString().slice(0, 10))).toEqual(['2026-06-04', '2026-06-05']);
  });
});
