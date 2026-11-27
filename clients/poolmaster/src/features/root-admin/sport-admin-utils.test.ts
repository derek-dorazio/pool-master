import { describe, expect, it } from 'vitest';
import {
  formatSportEventStatus,
  sportEventStatusTone,
} from './sport-admin-utils';

// plans/124 §6.3/§6.4 — pure helpers backing the golf admin keystone screens (pool-master-3dg).

describe('pool-master-3dg sport-admin-utils: status formatting', () => {
  it('an event status reads its display string, sentence case like every other status', () => {
    expect(formatSportEventStatus('IN_PROGRESS')).toBe('In progress');
    expect(formatSportEventStatus('SCHEDULED')).toBe('Scheduled');
  });

  it('pool-master-3dg tones live, completed, and warning statuses distinctly', () => {
    expect(sportEventStatusTone('IN_PROGRESS')).toBe('live');
    expect(sportEventStatusTone('COMPLETED')).toBe('completed');
    expect(sportEventStatusTone('CANCELLED')).toBe('warning');
    expect(sportEventStatusTone('POSTPONED')).toBe('warning');
    expect(sportEventStatusTone('SCHEDULED')).toBe('neutral');
  });
});
