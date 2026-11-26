import { ParticipantRoundStatus, RoundStatus, SlotKind } from '@poolmaster/shared/domain';
import { dailyRoundSchedule, providerEventRoundSchedule, roundsInSlots, SportEventRoundService } from '../../../packages/core-api/src/modules/events/sport-event-round-service';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';
import { expectDefined } from '../../support/expect-defined';

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

    const [eventSlot, otherSlot] = [store.eventSlotOf(event.id).id, store.eventSlotOf(other.id).id];

    await service.createSchedules([
      { sportEventId: event.id, rounds: [{ roundNumber: 1, scheduledDate: START, scheduledEndAt: new Date('2026-06-04T20:00:00.000Z'), seasonSlotId: eventSlot }] },
      { sportEventId: other.id, rounds: roundsInSlots(dailyRoundSchedule(2, START), [{ id: otherSlot, startsAt: START, endsAt: null }]) },
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

  it('adds the rounds in the event\'s one slot, and nothing when every round exists', async () => {
    const { store, event, service } = setup();
    await store.addRounds(event.id, [{ roundNumber: 1, scheduledDate: START }]);

    await service.extendTo({ sportEventId: event.id, rounds: 2, startDate: START });
    await service.extendTo({ sportEventId: event.id, rounds: 2, startDate: new Date('2030-01-01T00:00:00.000Z') });

    expect(store.roundRows.map((round) => [round.scheduledDate.toISOString().slice(0, 10), round.slot.seasonSlotId])).toEqual([
      ['2026-06-04', store.eventSlotOf(event.id).id],
      ['2026-06-05', store.eventSlotOf(event.id).id],
    ]);
  });

  it('refuses more rounds for an event played a round per slot (422 EVENT_ROUNDS_FROM_SLOTS): its slots give its round count', async () => {
    const { store, event, service } = setup();
    const [semifinal, final] = store.addRoundSlots(event.id, [{ slotKind: SlotKind.SEMIFINAL }, { slotKind: SlotKind.FINAL }]);
    await store.addRounds(event.id, [{ roundNumber: 1, scheduledDate: START }, { roundNumber: 2, scheduledDate: START }], (roundNumber) => (roundNumber === 1 ? semifinal : final));

    await expect(service.extendTo({ sportEventId: event.id, rounds: 3, startDate: START })).rejects.toMatchObject({ code: 'EVENT_ROUNDS_FROM_SLOTS', statusCode: 422 });
    expect(store.roundRows).toHaveLength(2);
  });
});

describe('SportEventRoundService.listRoundViews (#1889)', () => {
  it('gives each round where it stands from its recorded results, and a round with none as scheduled', async () => {
    const { store, event } = setup();
    await store.addRounds(event.id, [{ roundNumber: 1, scheduledDate: START }, { roundNumber: 2, scheduledDate: START }]);
    const rounds = store.roundRepo();
    const [first] = await rounds.findBySportEvent(event.id);
    const completedAt = new Date('2026-06-04T22:00:00.000Z');
    const service = new SportEventRoundService({
      rounds: {
        ...rounds,
        findResultFacts: async () => new Map([[expectDefined(first).id, {
          matches: [],
          participantRounds: [{ status: ParticipantRoundStatus.COMPLETED, count: 3, lastCompletedAt: completedAt }],
        }]]),
      },
    });

    const views = await service.listRoundViews(event.id);

    expect(views.map((view) => [view.roundNumber, view.progress])).toEqual([
      [1, { status: RoundStatus.COMPLETED, resultCount: 3, completedAt }],
      [2, { status: RoundStatus.SCHEDULED, resultCount: 0, completedAt: null }],
    ]);
  });
});

describe('providerEventRoundSchedule — a provider event created with no round count', () => {
  const startDate = new Date('2027-04-08T00:00:00.000Z');

  it('makes four rounds a day apart, the fourth on the provider\'s end date', () => {
    const endDate = new Date('2027-04-12T00:00:00.000Z');

    expect(providerEventRoundSchedule(startDate, endDate).map((round) => [round.roundNumber, round.scheduledDate.toISOString()])).toEqual([
      [1, '2027-04-08T00:00:00.000Z'],
      [2, '2027-04-09T00:00:00.000Z'],
      [3, '2027-04-10T00:00:00.000Z'],
      [4, '2027-04-12T00:00:00.000Z'],
    ]);
  });

  it('puts the fourth round three days after the start when the provider sends no end date', () => {
    expect(providerEventRoundSchedule(startDate, null).at(-1)).toEqual({ roundNumber: 4, scheduledDate: new Date('2027-04-11T00:00:00.000Z') });
  });
});

describe('roundsInSlots', () => {
  const schedule = dailyRoundSchedule(4, START);

  it('plays every round of the schedule in an event\'s one slot: a golf tournament\'s four in its tournament', () => {
    expect(roundsInSlots(schedule, [{ id: 'masters', startsAt: START, endsAt: null }]).map((round) => [round.roundNumber, round.seasonSlotId])).toEqual([
      [1, 'masters'], [2, 'masters'], [3, 'masters'], [4, 'masters'],
    ]);
  });

  it('plays a round in each of several slots, in their play order, dated by the slot, else by the schedule\'s start', () => {
    const final = new Date('2026-06-10T12:00:00.000Z');

    expect(roundsInSlots(schedule, [
      { id: 'semifinal', startsAt: null, endsAt: null },
      { id: 'final', startsAt: final, endsAt: null },
    ])).toEqual([
      { roundNumber: 1, scheduledDate: START, scheduledEndAt: null, seasonSlotId: 'semifinal' },
      { roundNumber: 2, scheduledDate: final, scheduledEndAt: null, seasonSlotId: 'final' },
    ]);
  });

  it('refuses an event of no slot', () => {
    expect(() => roundsInSlots(schedule, [])).toThrow('at least one Season slot');
  });
});
