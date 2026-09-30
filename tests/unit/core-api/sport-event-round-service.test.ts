import { SportEventRoundService } from '../../../packages/core-api/src/modules/events/sport-event-round-service';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';

// The round schedule's rules against an in-memory store: the default is sequential days
// and idempotent, and rescheduling only ever moves rounds that exist.

function setup() {
  const store = new InMemorySportEvents();
  const event = store.addEvent();
  return { store, event, service: new SportEventRoundService({ rounds: store.roundRepo() }) };
}

const START = new Date('2026-06-04T12:00:00.000Z');

describe('SportEventRoundService', () => {
  it('creates one round per day from the start, and a second call adds only the missing rounds', async () => {
    const { store, event, service } = setup();

    await service.ensureRounds({ sportEventId: event.id, rounds: 2, startDate: START });
    const rounds = await service.ensureRounds({ sportEventId: event.id, rounds: 3, startDate: new Date('2030-01-01T00:00:00.000Z') });

    expect(rounds.map((round) => [round.roundNumber, round.scheduledDate.toISOString().slice(0, 10)])).toEqual([
      [1, '2026-06-04'],
      [2, '2026-06-05'],
      // Only round 3 was missing, so only it takes the second call's start.
      [3, '2030-01-03'],
    ]);
    expect(store.roundRows).toHaveLength(3);
  });

  it('creates rounds from a derived schedule as given', async () => {
    const { event, service } = setup();

    const rounds = await service.createFromSchedule(event.id, [
      { roundNumber: 1, scheduledDate: START, scheduledEndAt: new Date('2026-06-04T20:00:00.000Z') },
    ]);

    expect(rounds).toEqual([expect.objectContaining({ roundNumber: 1, scheduledEndAt: new Date('2026-06-04T20:00:00.000Z') })]);
  });

  it('reschedules existing rounds, clearing an end set to null and keeping one left out', async () => {
    const { event, service } = setup();
    await service.createFromSchedule(event.id, [
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
