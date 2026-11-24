import { SUPPORTED_SPORTS, Sport, sportPathSegment } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import {
  MANAGE_LANDING_PATH,
  buildManageTabs,
  buildManageUserPath,
  buildSportEventPath,
  getManageBreadcrumbLabel,
  parseSportPathSegment,
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

  it('lands /manage on the Sports page, every sport league in one grid', () => {
    expect(MANAGE_LANDING_PATH).toBe('/manage/sports');
  });
});

describe('Manage menu and breadcrumbs per sport', () => {
  it('shows the top menu Sports to Pricing, keeping Sports lit on any page under a sport', () => {
    const tabs = buildManageTabs('/manage/sports/horse-racing/events/evt-1');

    expect(tabs.map((tab) => [tab.label, tab.isActive])).toEqual([
      ['Sports', true],
      ['Activity', false],
      ['Notifications', false],
      ['Providers', false],
      ['Customers', false],
      ['Plans', false],
      ['Pricing', false],
    ]);
  });

  it('lights Pricing on the Pricing page and names it Pricing in the breadcrumb', () => {
    expect(buildManageTabs('/manage/pricing').filter((tab) => tab.isActive).map((tab) => tab.label)).toEqual(['Pricing']);
    expect(getManageBreadcrumbLabel(['pricing'], 0)).toBe('Pricing');
  });

  it('lights Providers on Run event sync, Findings and a finding\'s map page, and Activity on the Activity page', () => {
    const lit = (pathname: string) => buildManageTabs(pathname).filter((tab) => tab.isActive).map((tab) => tab.label);

    expect(lit('/manage/providers/run-event-sync')).toEqual(['Providers']);
    expect(lit('/manage/providers/findings/f-1/map-participant')).toEqual(['Providers']);
    expect(lit('/manage/activity')).toEqual(['Activity']);
    expect(lit('/manage/notifications')).toEqual(['Notifications']);
    expect(lit('/manage/customers/users')).toEqual(['Customers']);
    expect(lit('/manage/events')).toEqual(['Sports']);
    expect(lit('/manage/content-configuration/how-to-play')).toEqual(['Sports']);
    expect(lit('/manage/nowhere')).toEqual([]);
  });

  it('names the profiles page\'s trail Profiles', () => {
    expect(getManageBreadcrumbLabel(['sports', 'profiles'], 1)).toBe('Profiles');
  });

  it('opens Customers on its Leagues tab, and names one user by a link to their dialog on the Users tab', () => {
    expect(buildManageTabs('/manage/plans').find((tab) => tab.label === 'Customers')?.to).toBe('/manage/customers/leagues');
    expect(buildManageUserPath('user-1')).toBe('/manage/customers/users?user=user-1');
  });

  it('names a cycling trail in cycling words: Cycling, Races, Riders', () => {
    expect(getManageBreadcrumbLabel(['sports', 'cycling', 'events'], 1)).toBe('Cycling');
    expect(getManageBreadcrumbLabel(['sports', 'cycling', 'events'], 2)).toBe('Races');
    expect(getManageBreadcrumbLabel(['sports', 'cycling', 'participants'], 2)).toBe('Riders');
  });

  it('names a basketball trail in basketball words: Basketball, Tournaments, Teams', () => {
    expect(getManageBreadcrumbLabel(['sports', 'basketball', 'events'], 1)).toBe('Basketball');
    expect(getManageBreadcrumbLabel(['sports', 'basketball', 'events'], 2)).toBe('Tournaments');
    expect(getManageBreadcrumbLabel(['sports', 'basketball', 'participants'], 2)).toBe('Teams');
  });

  it('names a running trail in running words: Running, Races, Runners', () => {
    expect(getManageBreadcrumbLabel(['sports', 'running', 'events'], 1)).toBe('Running');
    expect(getManageBreadcrumbLabel(['sports', 'running', 'events'], 2)).toBe('Races');
    expect(getManageBreadcrumbLabel(['sports', 'running', 'participants'], 2)).toBe('Runners');
  });

  it('names an auto racing trail in racing words: Auto racing, Races, Drivers', () => {
    expect(getManageBreadcrumbLabel(['sports', 'auto-racing', 'events'], 1)).toBe('Auto racing');
    expect(getManageBreadcrumbLabel(['sports', 'auto-racing', 'events'], 2)).toBe('Races');
    expect(getManageBreadcrumbLabel(['sports', 'auto-racing', 'participants'], 2)).toBe('Drivers');
  });

  it('names a horse racing trail in racing words: Horse racing, Races, Horses', () => {
    expect(getManageBreadcrumbLabel(['sports', 'horse-racing', 'events'], 1)).toBe('Horse racing');
    expect(getManageBreadcrumbLabel(['sports', 'horse-racing', 'events'], 2)).toBe('Races');
    expect(getManageBreadcrumbLabel(['sports', 'horse-racing', 'participants'], 2)).toBe('Horses');
  });

  it('names a golf trail in golf words: Tournaments, Golfers', () => {
    expect(getManageBreadcrumbLabel(['sports', 'golf', 'events'], 2)).toBe('Tournaments');
    expect(getManageBreadcrumbLabel(['sports', 'golf', 'participants'], 2)).toBe('Golfers');
  });

  it('names a sport league\'s trail step Sport leagues, in model words, whatever the sport calls its leagues', () => {
    expect(getManageBreadcrumbLabel(['sports', 'golf', 'leagues'], 2)).toBe('Sport leagues');
    expect(getManageBreadcrumbLabel(['sports', 'horse-racing', 'leagues'], 2)).toBe('Sport leagues');
  });

  it('names the renamed tools in the trail by their menu words: Activity, Notifications, Contest templates', () => {
    expect(getManageBreadcrumbLabel(['activity'], 0)).toBe('Activity');
    expect(getManageBreadcrumbLabel(['notifications'], 0)).toBe('Notifications');
    expect(getManageBreadcrumbLabel(['content-configuration'], 0)).toBe('Contest templates');
  });

  it('keeps the platform Leagues label outside a sport, so the platform list is not read as a sport\'s', () => {
    expect(getManageBreadcrumbLabel(['leagues'], 0)).toBe('Leagues');
  });
});
