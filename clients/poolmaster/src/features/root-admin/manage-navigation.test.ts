import { SUPPORTED_SPORTS, Sport } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import {
  SPORTS_LANDING_PATH,
  buildManageMenuItems,
  buildSportEventPath,
  getManageBreadcrumbLabel,
  parseSportPathSegment,
  sportPathSegment,
} from './manage-navigation';

describe('Manage sport paths (plans/racing-sports.md Q9.6)', () => {
  it('writes each sport as a lower-case, hyphenated URL segment: golf, horse-racing, auto-racing, cycling and running', () => {
    expect(sportPathSegment(Sport.GOLF)).toBe('golf');
    expect(sportPathSegment(Sport.HORSE_RACING)).toBe('horse-racing');
    expect(sportPathSegment(Sport.AUTO_RACING)).toBe('auto-racing');
    expect(sportPathSegment(Sport.CYCLING)).toBe('cycling');
    expect(sportPathSegment(Sport.RUNNING)).toBe('running');
  });

  it('reads every supported sport back from its own segment, so no two sports share a URL', () => {
    for (const sport of SUPPORTED_SPORTS) {
      expect(parseSportPathSegment(sportPathSegment(sport))).toBe(sport);
    }
  });

  it('reads no sport from a segment that names none, or from the enum spelling', () => {
    expect(parseSportPathSegment('cricket')).toBeNull();
    expect(parseSportPathSegment('HORSE_RACING')).toBeNull();
    expect(parseSportPathSegment(undefined)).toBeNull();
  });

  it('puts a horse race\'s pages under the horse racing segment', () => {
    expect(buildSportEventPath(Sport.HORSE_RACING, 'evt-1')).toBe('/manage/sports/horse-racing/events/evt-1');
  });

  it('lands /manage/sports on the first supported sport\'s events', () => {
    expect(SPORTS_LANDING_PATH).toBe(`/manage/sports/${sportPathSegment(SUPPORTED_SPORTS[0])}/events`);
  });
});

describe('Manage menu and breadcrumbs per sport', () => {
  it('lists each supported sport by name under Sports and marks the one being managed', () => {
    const sports = buildManageMenuItems('/manage/sports/horse-racing/events/evt-1')
      .filter((item) => item.group === 'Sports');

    expect(sports.map((item) => [item.label, item.isActive])).toEqual([
      ['Golf', false],
      ['Horse racing', true],
      ['Auto racing', false],
      ['Cycling', false],
      ['Running', false],
      ['Basketball', false],
      ['American football', false],
      ['Hockey', false],
      ['Baseball', false],
      ['Soccer', false],
    ]);
  });

  it('names a cycling trail in cycling words: Cycling, Races, Riders, Tours', () => {
    expect(getManageBreadcrumbLabel(['sports', 'cycling', 'events'], 1)).toBe('Cycling');
    expect(getManageBreadcrumbLabel(['sports', 'cycling', 'events'], 2)).toBe('Races');
    expect(getManageBreadcrumbLabel(['sports', 'cycling', 'participants'], 2)).toBe('Riders');
    expect(getManageBreadcrumbLabel(['sports', 'cycling', 'leagues'], 2)).toBe('Tours');
  });

  it('names a basketball trail in basketball words: Basketball, Tournaments, Teams, Leagues', () => {
    expect(getManageBreadcrumbLabel(['sports', 'basketball', 'events'], 1)).toBe('Basketball');
    expect(getManageBreadcrumbLabel(['sports', 'basketball', 'events'], 2)).toBe('Tournaments');
    expect(getManageBreadcrumbLabel(['sports', 'basketball', 'participants'], 2)).toBe('Teams');
    expect(getManageBreadcrumbLabel(['sports', 'basketball', 'leagues'], 2)).toBe('Leagues');
  });

  it('names a running trail in running words: Running, Races, Runners, Series', () => {
    expect(getManageBreadcrumbLabel(['sports', 'running', 'events'], 1)).toBe('Running');
    expect(getManageBreadcrumbLabel(['sports', 'running', 'events'], 2)).toBe('Races');
    expect(getManageBreadcrumbLabel(['sports', 'running', 'participants'], 2)).toBe('Runners');
    expect(getManageBreadcrumbLabel(['sports', 'running', 'leagues'], 2)).toBe('Series');
  });

  it('names an auto racing trail in racing words: Auto racing, Races, Drivers, Series', () => {
    expect(getManageBreadcrumbLabel(['sports', 'auto-racing', 'events'], 1)).toBe('Auto racing');
    expect(getManageBreadcrumbLabel(['sports', 'auto-racing', 'events'], 2)).toBe('Races');
    expect(getManageBreadcrumbLabel(['sports', 'auto-racing', 'participants'], 2)).toBe('Drivers');
    expect(getManageBreadcrumbLabel(['sports', 'auto-racing', 'leagues'], 2)).toBe('Series');
  });

  it('names a horse racing trail in racing words: Horse racing, Races, Horses, Circuits', () => {
    expect(getManageBreadcrumbLabel(['sports', 'horse-racing', 'events'], 1)).toBe('Horse racing');
    expect(getManageBreadcrumbLabel(['sports', 'horse-racing', 'events'], 2)).toBe('Races');
    expect(getManageBreadcrumbLabel(['sports', 'horse-racing', 'participants'], 2)).toBe('Horses');
    expect(getManageBreadcrumbLabel(['sports', 'horse-racing', 'leagues'], 2)).toBe('Circuits');
  });

  it('names a golf trail in golf words: Tournaments, Golfers, Tours', () => {
    expect(getManageBreadcrumbLabel(['sports', 'golf', 'events'], 2)).toBe('Tournaments');
    expect(getManageBreadcrumbLabel(['sports', 'golf', 'participants'], 2)).toBe('Golfers');
    expect(getManageBreadcrumbLabel(['sports', 'golf', 'leagues'], 2)).toBe('Tours');
  });

  it('keeps the platform Leagues label outside a sport, so the platform list is not read as a sport\'s', () => {
    expect(getManageBreadcrumbLabel(['leagues'], 0)).toBe('Leagues');
  });
});
