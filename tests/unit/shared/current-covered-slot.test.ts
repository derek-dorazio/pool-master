import { describe, expect, it } from '@jest/globals';
import { SportEventStatus, currentCoveredSlot } from '@poolmaster/shared/domain';

const NOW = new Date('2026-12-10T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const at = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * HOUR);

function event(startOffsetHours: number, status: SportEventStatus = SportEventStatus.SCHEDULED) {
  return { status, startDate: at(startOffsetHours) };
}

function slot(seasonSlotId: string, sportEventId: string | null, startsAt: Date | null = null) {
  return { seasonSlotId, sportEventId, startsAt };
}

const events = new Map([
  ['week-14', event(-30 * 24, SportEventStatus.COMPLETED)],
  ['week-15', event(-1)], // start time passed, status not yet moved on
  ['week-16', event(24)],
  ['week-17', event(24 * 7)],
  ['bracket', event(-2, SportEventStatus.IN_PROGRESS)],
]);

describe('currentCoveredSlot — the slot a contest\'s pages open on', () => {
  it('opens on the first covered slot in play order that has not started', () => {
    const weeks = [slot('s-14', 'week-14'), slot('s-15', 'week-15'), slot('s-16', 'week-16'), slot('s-17', 'week-17')];
    expect(currentCoveredSlot(weeks, events, NOW)?.seasonSlotId).toBe('s-16');
  });

  it('opens a bracket on its next round once its first is played, though both share one event', () => {
    const rounds = [slot('r64', 'bracket', at(-2)), slot('r32', 'bracket', at(48)), slot('s16', 'bracket', at(96))];
    expect(currentCoveredSlot(rounds, events, NOW)?.seasonSlotId).toBe('r32');
  });

  it('opens on the last covered slot once every one has started', () => {
    expect(currentCoveredSlot([slot('s-14', 'week-14'), slot('s-15', 'week-15')], events, NOW)?.seasonSlotId).toBe('s-15');
  });

  it('counts a slot with no games of its own placed as started once its event starts, by start time or by status', () => {
    expect(currentCoveredSlot([slot('s-15', 'week-15'), slot('s-16', 'week-16')], events, NOW)?.seasonSlotId).toBe('s-16');
  });

  it('never counts as started a slot no event plays yet, or one whose event has not started though its games\' dates have passed', () => {
    expect(currentCoveredSlot([slot('s-none', null, at(-5)), slot('s-17', 'week-17')], events, NOW)?.seasonSlotId).toBe('s-none');
    expect(currentCoveredSlot([slot('s-16', 'week-16', at(-5)), slot('s-17', 'week-17')], events, NOW)?.seasonSlotId).toBe('s-16');
  });

  it('reads a slot start sent as an ISO string as the API gives it', () => {
    const rounds = [{ seasonSlotId: 'r64', sportEventId: 'bracket', startsAt: at(-2).toISOString() }, { seasonSlotId: 'r32', sportEventId: 'bracket', startsAt: at(48).toISOString() }];
    expect(currentCoveredSlot(rounds, events, NOW)?.seasonSlotId).toBe('r32');
  });

  it('answers no slot for a contest that covers none', () => {
    expect(currentCoveredSlot<ReturnType<typeof slot>>([], events, NOW)).toBeUndefined();
  });
});
