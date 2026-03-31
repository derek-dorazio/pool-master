import { describe, it, expect } from 'vitest';
import { TIMEZONES, searchTimezones, getTimezonesByRegion } from '@/lib/timezones';

describe('timezones', () => {
  it('TIMEZONES has 50+ entries', () => {
    expect(TIMEZONES.length).toBeGreaterThanOrEqual(50);
  });

  it('each entry has iana (IANA string) and label properties', () => {
    for (const tz of TIMEZONES) {
      expect(tz.iana).toBeTruthy();
      expect(typeof tz.iana).toBe('string');
      expect(tz.label).toBeTruthy();
      expect(typeof tz.label).toBe('string');
      expect(tz.region).toBeTruthy();
    }
  });

  it('searchTimezones("new york") returns America/New_York', () => {
    const results = searchTimezones('new york');
    expect(results.some((tz) => tz.iana === 'America/New_York')).toBe(true);
  });

  it('searchTimezones("london") returns Europe/London', () => {
    const results = searchTimezones('london');
    expect(results.some((tz) => tz.iana === 'Europe/London')).toBe(true);
  });

  it('searchTimezones("") returns all timezones', () => {
    const results = searchTimezones('');
    expect(results.length).toBe(TIMEZONES.length);
  });

  it('getTimezonesByRegion() returns grouped object with expected region keys', () => {
    const grouped = getTimezonesByRegion();
    expect(grouped).toHaveProperty('Americas');
    expect(grouped).toHaveProperty('Europe');
    expect(grouped).toHaveProperty('Asia');
    expect(grouped).toHaveProperty('Pacific');
    expect(grouped).toHaveProperty('Africa');
  });

  it('each region has at least 1 timezone', () => {
    const grouped = getTimezonesByRegion();
    for (const region of Object.keys(grouped)) {
      expect(grouped[region].length).toBeGreaterThanOrEqual(1);
    }
  });
});
