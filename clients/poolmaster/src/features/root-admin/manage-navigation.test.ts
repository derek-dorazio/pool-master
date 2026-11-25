import { Sport } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import {
  MANAGE_LANDING_PATH,
  buildManageTabs,
  buildManageUserPath,
  buildSportEventPath,
  getManageBreadcrumbLabel,
  type SportAddress,
} from './manage-navigation';

/** The platform's sports as `listSports` gives them: each one's stored URL segment. */
const SPORTS: SportAddress[] = [
  { sport: Sport.AMERICAN_FOOTBALL, urlSegment: 'american-football' },
  { sport: Sport.BASKETBALL, urlSegment: 'basketball' },
  { sport: Sport.GOLF, urlSegment: 'golf' },
  { sport: Sport.AUTO_RACING, urlSegment: 'auto-racing' },
  { sport: Sport.HORSE_RACING, urlSegment: 'horse-racing' },
  { sport: Sport.CYCLING, urlSegment: 'cycling' },
  { sport: Sport.RUNNING, urlSegment: 'running' },
];

describe('Manage sport paths (plans/racing-sports.md Q9.6)', () => {
  it('names a sport\'s pages by the URL segment the API gives it, never by the enum spelling', () => {
    expect(buildSportEventPath('horse-racing', 'evt-1')).toBe('/manage/sports/horse-racing/events/evt-1');
  });

  it('names a trail\'s sport only when the platform\'s sports have its segment', () => {
    expect(getManageBreadcrumbLabel(['sports', 'cricket', 'events'], 1, SPORTS)).toBe('cricket');
    expect(getManageBreadcrumbLabel(['sports', 'HORSE_RACING', 'events'], 1, SPORTS)).toBe('HORSE_RACING');
    expect(getManageBreadcrumbLabel(['sports', 'golf', 'events'], 1, [])).toBe('golf');
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
    expect(getManageBreadcrumbLabel(['sports', 'cycling', 'events'], 1, SPORTS)).toBe('Cycling');
    expect(getManageBreadcrumbLabel(['sports', 'cycling', 'events'], 2, SPORTS)).toBe('Races');
    expect(getManageBreadcrumbLabel(['sports', 'cycling', 'participants'], 2, SPORTS)).toBe('Riders');
  });

  it('names a basketball trail in basketball words: Basketball, Tournaments, Teams', () => {
    expect(getManageBreadcrumbLabel(['sports', 'basketball', 'events'], 1, SPORTS)).toBe('Basketball');
    expect(getManageBreadcrumbLabel(['sports', 'basketball', 'events'], 2, SPORTS)).toBe('Tournaments');
    expect(getManageBreadcrumbLabel(['sports', 'basketball', 'participants'], 2, SPORTS)).toBe('Teams');
  });

  it('names a running trail in running words: Running, Races, Runners', () => {
    expect(getManageBreadcrumbLabel(['sports', 'running', 'events'], 1, SPORTS)).toBe('Running');
    expect(getManageBreadcrumbLabel(['sports', 'running', 'events'], 2, SPORTS)).toBe('Races');
    expect(getManageBreadcrumbLabel(['sports', 'running', 'participants'], 2, SPORTS)).toBe('Runners');
  });

  it('names an auto racing trail in racing words: Auto racing, Races, Drivers', () => {
    expect(getManageBreadcrumbLabel(['sports', 'auto-racing', 'events'], 1, SPORTS)).toBe('Auto racing');
    expect(getManageBreadcrumbLabel(['sports', 'auto-racing', 'events'], 2, SPORTS)).toBe('Races');
    expect(getManageBreadcrumbLabel(['sports', 'auto-racing', 'participants'], 2, SPORTS)).toBe('Drivers');
  });

  it('names a horse racing trail in racing words: Horse racing, Races, Horses', () => {
    expect(getManageBreadcrumbLabel(['sports', 'horse-racing', 'events'], 1, SPORTS)).toBe('Horse racing');
    expect(getManageBreadcrumbLabel(['sports', 'horse-racing', 'events'], 2, SPORTS)).toBe('Races');
    expect(getManageBreadcrumbLabel(['sports', 'horse-racing', 'participants'], 2, SPORTS)).toBe('Horses');
  });

  it('names a golf trail in golf words: Tournaments, Golfers', () => {
    expect(getManageBreadcrumbLabel(['sports', 'golf', 'events'], 2, SPORTS)).toBe('Tournaments');
    expect(getManageBreadcrumbLabel(['sports', 'golf', 'participants'], 2, SPORTS)).toBe('Golfers');
  });

  it('names a sport league\'s trail step Sport leagues, in model words, whatever the sport calls its leagues', () => {
    expect(getManageBreadcrumbLabel(['sports', 'golf', 'leagues'], 2, SPORTS)).toBe('Sport leagues');
    expect(getManageBreadcrumbLabel(['sports', 'horse-racing', 'leagues'], 2, SPORTS)).toBe('Sport leagues');
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
