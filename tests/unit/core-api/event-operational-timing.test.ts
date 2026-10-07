import {
  evaluateEventOperationalState,
  hasSportEventStarted,
} from '../../../packages/core-api/src/modules/events/operational-timing';

// #431 — readiness comes from the event's status and start time, not from release and
// field-lock timestamps. `now` is always passed, so nothing here depends on today's date.
const now = new Date('2026-04-01T12:00:00.000Z');
const beforeStart = new Date('2026-04-10T12:00:00.000Z');

describe('event operational state', () => {
  it('is contest-eligible once released (SCHEDULED) with a loaded field, before the start time', () => {
    const state = evaluateEventOperationalState({ status: 'SCHEDULED', startDate: beforeStart, participantCount: 72, now });

    expect(state).toEqual({ readinessStatus: 'CONTEST_ELIGIBLE', readinessReasons: [], contestEligible: true });
  });

  it('is not released while the event is a DRAFT, however ready its field is', () => {
    const state = evaluateEventOperationalState({ status: 'DRAFT', startDate: beforeStart, participantCount: 72, now });

    expect(state).toEqual({ readinessStatus: 'NOT_RELEASED', readinessReasons: ['EVENT_NOT_RELEASED'], contestEligible: false });
  });

  it('is pending its field when a released event has no participants loaded', () => {
    const state = evaluateEventOperationalState({ status: 'SCHEDULED', startDate: beforeStart, participantCount: 0, now });

    expect(state).toEqual({ readinessStatus: 'PENDING_FIELD', readinessReasons: ['FIELD_NOT_LOADED'], contestEligible: false });
  });

  it('is started once the start time has passed, even while the status still says SCHEDULED', () => {
    const state = evaluateEventOperationalState({ status: 'SCHEDULED', startDate: now, participantCount: 72, now });

    expect(state).toEqual({ readinessStatus: 'EVENT_STARTED', readinessReasons: ['EVENT_STARTED'], contestEligible: false });
  });

  it('reports every blocker and ranks started above not released above pending field', () => {
    const state = evaluateEventOperationalState({
      status: 'DRAFT',
      startDate: new Date('2026-03-01T12:00:00.000Z'),
      participantCount: 0,
      now,
    });

    expect(state.readinessReasons).toEqual(['EVENT_NOT_RELEASED', 'FIELD_NOT_LOADED', 'EVENT_STARTED']);
    expect(state.readinessStatus).toBe('EVENT_STARTED');
  });
});

describe('hasSportEventStarted', () => {
  it('is false for a scheduled or postponed event whose start is still ahead', () => {
    expect(hasSportEventStarted({ status: 'SCHEDULED', startDate: beforeStart }, now)).toBe(false);
    expect(hasSportEventStarted({ status: 'POSTPONED', startDate: beforeStart }, now)).toBe(false);
  });

  it('is true at the start time, and for an event in progress, completed or cancelled whatever its start', () => {
    expect(hasSportEventStarted({ status: 'SCHEDULED', startDate: now }, now)).toBe(true);
    expect(hasSportEventStarted({ status: 'IN_PROGRESS', startDate: beforeStart }, now)).toBe(true);
    expect(hasSportEventStarted({ status: 'COMPLETED', startDate: beforeStart }, now)).toBe(true);
    expect(hasSportEventStarted({ status: 'CANCELLED', startDate: beforeStart }, now)).toBe(true);
  });
});
