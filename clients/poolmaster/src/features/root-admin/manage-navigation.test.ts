import { SUPPORTED_SPORTS, Sport, sportPathSegment } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import {
  MANAGE_LANDING_PATH,
  buildManageSubTabs,
  buildManageTabs,
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

  it('lights Providers, not Activity, on Run event sync, and Activity on the rest of the sync pages', () => {
    const lit = (pathname: string) => buildManageTabs(pathname).filter((tab) => tab.isActive).map((tab) => tab.label);

    expect(lit('/manage/sync/run-event-sync')).toEqual(['Providers']);
    expect(lit('/manage/sync/unmapped-participants/map')).toEqual(['Providers']);
    expect(lit('/manage/sync')).toEqual(['Activity']);
    expect(lit('/manage/settings')).toEqual(['Notifications']);
    expect(lit('/manage/users/user-1')).toEqual(['Customers']);
    expect(lit('/manage/events')).toEqual(['Sports']);
    expect(lit('/manage/content-configuration/how-to-play')).toEqual(['Sports']);
    expect(lit('/manage/nowhere')).toEqual([]);
  });

  it('under Sports, shows Sport leagues, Events, Contest templates, then each supported sport, marking the sport being managed', () => {
    const row = buildManageSubTabs('/manage/sports/horse-racing/events/evt-1');

    expect(row?.items.map((tab) => [tab.label, tab.isActive])).toEqual([
      ['Sport leagues', false],
      ['Events', false],
      ['Contest templates', false],
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
      ['Tennis', false],
    ]);
    expect(row?.items[4].to).toBe('/manage/sports/horse-racing/events');
  });

  it('keeps Sport leagues lit on the Sports page and on a sport league\'s own pages, not its sport', () => {
    const lit = (pathname: string) => buildManageSubTabs(pathname)?.items.filter((tab) => tab.isActive).map((tab) => tab.label);

    expect(lit('/manage/sports')).toEqual(['Sport leagues']);
    expect(lit('/manage/sports/golf/leagues/league-1/edit')).toEqual(['Sport leagues']);
    expect(lit('/manage/events')).toEqual(['Events']);
    expect(lit('/manage/content-configuration')).toEqual(['Contest templates']);
  });

  it('lights nothing in the second row on the profiles page, whose own tabs mark Profiles, and names its trail Profiles', () => {
    expect(buildManageSubTabs('/manage/sports/profiles')?.items.filter((tab) => tab.isActive)).toEqual([]);
    expect(getManageBreadcrumbLabel(['sports', 'profiles'], 1)).toBe('Profiles');
  });

  it('under Customers, shows Leagues and Users', () => {
    expect(buildManageSubTabs('/manage/users/user-1')?.items.map((tab) => [tab.label, tab.isActive])).toEqual([
      ['Leagues', false],
      ['Users', true],
    ]);
  });

  it('has no second row under Activity, Notifications, Providers, Plans or Pricing', () => {
    expect(buildManageSubTabs('/manage/sync')).toBeNull();
    expect(buildManageSubTabs('/manage/settings')).toBeNull();
    expect(buildManageSubTabs('/manage/plans')).toBeNull();
    expect(buildManageSubTabs('/manage/pricing')).toBeNull();
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
    expect(getManageBreadcrumbLabel(['sync'], 0)).toBe('Activity');
    expect(getManageBreadcrumbLabel(['settings'], 0)).toBe('Notifications');
    expect(getManageBreadcrumbLabel(['content-configuration'], 0)).toBe('Contest templates');
  });

  it('keeps the platform Leagues label outside a sport, so the platform list is not read as a sport\'s', () => {
    expect(getManageBreadcrumbLabel(['leagues'], 0)).toBe('Leagues');
  });
});
