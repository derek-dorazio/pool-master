import {
  evaluateEventOperationalState,
  resolveEventTiming,
} from '../../../packages/core-api/src/modules/events/operational-timing';

describe('event operational timing', () => {
  it('resolves supported relative timing rules against the event start date', () => {
    const startDate = new Date('2026-04-12T16:00:00.000Z');

    const resolved = resolveEventTiming(
      {
        sport: 'GOLF',
        startDate,
        metadata: {},
      },
      {
        releaseRule: '3 days prior at 12:00',
        fieldLockRule: '1 day prior at 09:30',
      },
    );

    expect(resolved.releaseAt.toISOString()).toBe('2026-04-09T12:00:00.000Z');
    expect(resolved.fieldLocksAt.toISOString()).toBe('2026-04-11T09:30:00.000Z');
  });

  it('falls back to the event start date when no policy exists', () => {
    const startDate = new Date('2026-05-01T14:00:00.000Z');

    const resolved = resolveEventTiming({
      sport: 'GOLF',
      startDate,
      metadata: {},
    });

    expect(resolved.releaseAt.toISOString()).toBe(startDate.toISOString());
    expect(resolved.fieldLocksAt.toISOString()).toBe(startDate.toISOString());
  });

  it('marks events contest-eligible only after release, before field lock, and with a field loaded', () => {
    const state = evaluateEventOperationalState({
      participantCount: 144,
      releaseAt: new Date('2026-04-09T12:00:00.000Z'),
      fieldLocksAt: new Date('2026-04-11T12:00:00.000Z'),
      providerFieldLocked: false,
      now: new Date('2026-04-10T12:00:00.000Z'),
    });

    expect(state.readinessStatus).toBe('CONTEST_ELIGIBLE');
    expect(state.readinessReasons).toEqual([]);
    expect(state.contestEligible).toBe(true);
    expect(state.fieldLocked).toBe(false);
  });

  it('surfaces release, field, and lock reasons when the event is not eligible', () => {
    const state = evaluateEventOperationalState({
      participantCount: 0,
      releaseAt: new Date('2026-04-09T12:00:00.000Z'),
      fieldLocksAt: new Date('2026-04-11T12:00:00.000Z'),
      providerFieldLocked: false,
      now: new Date('2026-04-08T12:00:00.000Z'),
    });

    expect(state.readinessStatus).toBe('NOT_RELEASED');
    expect(state.readinessReasons).toEqual([
      'EVENT_NOT_RELEASED',
      'FIELD_NOT_LOADED',
    ]);
    expect(state.contestEligible).toBe(false);
  });
});
