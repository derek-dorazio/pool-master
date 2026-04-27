import {
  evaluateEventOperationalState,
  resolveEventTiming,
  selectTimingPolicy,
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

  it('pool-master-940 honors provider release and field-lock timestamps when no timing policy exists', () => {
    const startDate = new Date('2026-05-01T14:00:00.000Z');

    const resolved = resolveEventTiming({
      sport: 'GOLF',
      startDate,
      metadata: {
        releaseAt: '2026-04-26T16:00:00.000Z',
        fieldLocksAt: '2026-04-30T16:00:00.000Z',
      },
    });

    expect(resolved.releaseAt.toISOString()).toBe('2026-04-26T16:00:00.000Z');
    expect(resolved.fieldLocksAt.toISOString()).toBe('2026-04-30T16:00:00.000Z');
  });

  it('falls back to the event start date when a timing rule is invalid', () => {
    const startDate = new Date('2026-05-01T14:00:00.000Z');

    const resolved = resolveEventTiming(
      {
        sport: 'GOLF',
        startDate,
        metadata: {},
      },
      {
        releaseRule: 'not a real rule',
        fieldLockRule: '2 days prior at 25:00',
      },
    );

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

  it('marks the event field locked when the provider says the field is locked', () => {
    const state = evaluateEventOperationalState({
      participantCount: 144,
      releaseAt: new Date('2026-04-09T12:00:00.000Z'),
      fieldLocksAt: new Date('2026-04-11T12:00:00.000Z'),
      providerFieldLocked: true,
      now: new Date('2026-04-10T12:00:00.000Z'),
    });

    expect(state.readinessStatus).toBe('FIELD_LOCKED');
    expect(state.readinessReasons).toEqual(['FIELD_LOCKED']);
    expect(state.fieldLocked).toBe(true);
    expect(state.contestEligible).toBe(false);
  });

  it('prioritizes FIELD_LOCKED when multiple readiness blockers apply', () => {
    const state = evaluateEventOperationalState({
      participantCount: 0,
      releaseAt: new Date('2026-04-09T12:00:00.000Z'),
      fieldLocksAt: new Date('2026-04-11T12:00:00.000Z'),
      providerFieldLocked: false,
      now: new Date('2026-04-08T12:00:00.000Z'),
    });

    const afterLock = evaluateEventOperationalState({
      ...state,
      participantCount: 0,
      providerFieldLocked: false,
      now: new Date('2026-04-11T12:00:00.000Z'),
    });

    expect(afterLock.readinessStatus).toBe('FIELD_LOCKED');
    expect(afterLock.readinessReasons).toEqual([
      'FIELD_NOT_LOADED',
      'FIELD_LOCKED',
    ]);
  });

  it('selects the exact event-type timing policy when available', () => {
    const policy = selectTimingPolicy(
      [
        {
          eventType: 'MAJOR',
          isDefault: false,
          releaseRule: '3 days prior at 12:00',
          fieldLockRule: '1 day prior at 09:30',
        },
        {
          eventType: null,
          isDefault: true,
          releaseRule: '2 days prior at 12:00',
          fieldLockRule: '1 day prior at 12:00',
        },
      ],
      { eventType: 'MAJOR' },
    );

    expect(policy?.releaseRule).toBe('3 days prior at 12:00');
  });

  it('falls back to the default timing policy and then the first policy', () => {
    const defaultPolicy = selectTimingPolicy(
      [
        {
          eventType: 'INVITATIONAL',
          isDefault: false,
          releaseRule: '4 days prior at 12:00',
          fieldLockRule: '1 day prior at 09:30',
        },
        {
          eventType: null,
          isDefault: true,
          releaseRule: '2 days prior at 12:00',
          fieldLockRule: '1 day prior at 12:00',
        },
      ],
      { eventType: 'MAJOR' },
    );

    expect(defaultPolicy?.releaseRule).toBe('2 days prior at 12:00');

    const firstPolicy = selectTimingPolicy(
      [
        {
          eventType: 'INVITATIONAL',
          isDefault: false,
          releaseRule: '4 days prior at 12:00',
          fieldLockRule: '1 day prior at 09:30',
        },
      ],
      { eventType: 'MAJOR' },
    );

    expect(firstPolicy?.releaseRule).toBe('4 days prior at 12:00');
  });
});
