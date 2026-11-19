import { describe, expect, it } from 'vitest';
import { overdueLateness } from './sport-league-overview-text';

describe('overdueLateness', () => {
  const now = new Date('2026-11-19T12:00:00.000Z');

  it('counts whole hours late under two days', () => {
    expect(overdueLateness('2026-11-19T06:30:00.000Z', now)).toBe('5 hours late');
    expect(overdueLateness('2026-11-17T13:00:00.000Z', now)).toBe('47 hours late');
  });

  it('counts whole days late from two days on', () => {
    expect(overdueLateness('2026-11-17T12:00:00.000Z', now)).toBe('2 days late');
    expect(overdueLateness('2026-11-09T11:00:00.000Z', now)).toBe('10 days late');
  });
});
