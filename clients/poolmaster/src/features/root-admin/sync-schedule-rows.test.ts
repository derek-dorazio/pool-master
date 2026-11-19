import { describe, expect, it } from 'vitest';
import { formatInterval } from './sync-schedule-rows';

describe('formatInterval', () => {
  it('names an interval in the shortest words: seconds, minutes, hours, or hours with minutes', () => {
    expect(formatInterval(30)).toBe('30 s');
    expect(formatInterval(90)).toBe('1 min 30 s');
    expect(formatInterval(300)).toBe('5 min');
    expect(formatInterval(6 * 3600)).toBe('6 h');
    expect(formatInterval(90 * 60)).toBe('1 h 30 min');
  });
});
