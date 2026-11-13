import { describe, expect, it } from 'vitest';
import type { ContestConfigTemplateDto } from '@/lib/api';
import { sportLeagueFixture } from '@/features/root-admin/sport-test-fixtures';
import { buildLeagueContestCatalog, buildPublicContestCatalog, catalogSlug, contestTypeCount } from './contest-catalog';

const NFL = '80300000-0000-4000-8000-000000000001';
const CFP = '80300000-0000-4000-8000-000000000002';
const LPGA = '80300000-0000-4000-8000-000000000003';
const PGA = '80300000-0000-4000-8000-000000000004';
const XFL = '80300000-0000-4000-8000-000000000005';

function template(templateKey: string, overrides: Partial<ContestConfigTemplateDto>): ContestConfigTemplateDto {
  return {
    id: `id-${templateKey}`,
    sport: 'AMERICAN_FOOTBALL',
    sportLeagueId: NFL,
    eventType: 'KNOCKOUT',
    contestFormat: 'ROSTER',
    selectionType: 'TIERED',
    templateKey,
    name: templateKey,
    description: `${templateKey}.`,
    sortOrder: 1,
    isDefault: false,
    active: true,
    schemaVersion: 1,
    configuration: { selectionType: 'TIERED', picksPerTier: 1, countedScores: 4, maxEntriesPerSquad: 1 },
    ...overrides,
  };
}

const TEMPLATES = [
  template('nfl-tiered-doubling-upset-bonus', { sortOrder: 2 }),
  template('nfl-tiered-doubling', { isDefault: true }),
  template('nfl-survivor', { eventType: 'WEEK', selectionType: 'SURVIVOR', isDefault: true, sortOrder: 4 }),
  template('nfl-playoff-survivor', { selectionType: 'SURVIVOR', isDefault: true, sortOrder: 11 }),
  template('nfl-squares', { eventType: null, selectionType: 'SQUARES', contestFormat: 'SQUARES', isDefault: true, sortOrder: 10 }),
  template('cfp-tiered-doubling', { sportLeagueId: CFP, isDefault: true }),
  template('golf-tiered-pick-6', { sport: 'GOLF', sportLeagueId: null, eventType: null, isDefault: true }),
  template('golf-budget-pick-6-best-4', { sport: 'GOLF', sportLeagueId: null, eventType: null, selectionType: 'BUDGET_PICK', isDefault: true, sortOrder: 3 }),
  template('lpga-tour-majors-tiered', { sport: 'GOLF', sportLeagueId: LPGA, eventType: null, sortOrder: 5 }),
];

describe('the contest types catalog', () => {
  const LEAGUES = [
    sportLeagueFixture({ id: PGA, sport: 'GOLF', name: 'PGA TOUR', displayOrder: 10 }),
    sportLeagueFixture({ id: LPGA, sport: 'GOLF', name: 'LPGA Tour', displayOrder: 20 }),
    sportLeagueFixture({ id: NFL, sport: 'AMERICAN_FOOTBALL', name: 'NFL', displayOrder: 10 }),
    sportLeagueFixture({ id: CFP, sport: 'AMERICAN_FOOTBALL', name: 'College Football Playoff', displayOrder: 20 }),
  ];

  it('gives each sport, in the platform\'s order, one section per active sport league in display order, and no section for every event', () => {
    const catalog = buildLeagueContestCatalog(TEMPLATES, [
      ...LEAGUES,
      sportLeagueFixture({ id: XFL, sport: 'AMERICAN_FOOTBALL', name: 'XFL', isActive: false, displayOrder: 30 }),
    ]);

    expect(catalog.map(({ sport, groups }) => [sport, groups.map(({ name }) => name)])).toEqual([
      ['GOLF', ['PGA TOUR', 'LPGA Tour']],
      ['AMERICAN_FOOTBALL', ['NFL', 'College Football Playoff']],
    ]);
  });

  it('lists in a league\'s section its sport\'s every-event templates beside its own, its own leading their format with the sport\'s as variations', () => {
    const catalog = buildLeagueContestCatalog([
      ...TEMPLATES,
      template('golf-tiered-pick-12', { sport: 'GOLF', sportLeagueId: null, eventType: null, sortOrder: 2 }),
    ], LEAGUES);
    const golf = catalog.find(({ sport }) => sport === 'GOLF')?.groups;

    expect(golf?.map(({ name, tiles }) => [name, tiles.map(({ featured, variations }) => [featured.templateKey, variations.map(({ templateKey }) => templateKey)])])).toEqual([
      ['PGA TOUR', [
        ['golf-tiered-pick-6', ['golf-tiered-pick-12']],
        ['golf-budget-pick-6-best-4', []],
      ]],
      ['LPGA Tour', [
        ['lpga-tour-majors-tiered', ['golf-tiered-pick-6', 'golf-tiered-pick-12']],
        ['golf-budget-pick-6-best-4', []],
      ]],
    ]);
  });

  it('gives a league with only its sport\'s every-event templates a section of its own', () => {
    const catalog = buildLeagueContestCatalog([
      template('horse-racing-tiered', { sport: 'HORSE_RACING', sportLeagueId: null, eventType: null, isDefault: true }),
      template('horse-racing-budget', { sport: 'HORSE_RACING', sportLeagueId: null, eventType: null, selectionType: 'BUDGET_PICK', isDefault: true }),
    ], [sportLeagueFixture({ id: 'us-thoroughbred', sport: 'HORSE_RACING', name: 'US Thoroughbred', displayOrder: 10 })]);

    expect(catalog.map(({ sport, groups }) => [sport, groups.map(({ name, slug, tiles }) => [name, slug, tiles.length])])).toEqual([
      ['HORSE_RACING', [['US Thoroughbred', 'us-thoroughbred', 2]]],
    ]);
  });

  it('gives a league one tile per format and kind of event, in its sport\'s format order, each led by its default with the other templates of that format as variations', () => {
    const catalog = buildLeagueContestCatalog(TEMPLATES, LEAGUES);
    const nfl = catalog.find(({ sport }) => sport === 'AMERICAN_FOOTBALL')?.groups.find(({ name }) => name === 'NFL');

    expect(nfl?.tiles.map(({ featured, variations }) => [featured.templateKey, variations.map(({ templateKey }) => templateKey)])).toEqual([
      ['nfl-tiered-doubling', ['nfl-tiered-doubling-upset-bonus']],
      ['nfl-survivor', []],
      ['nfl-playoff-survivor', []],
      ['nfl-squares', []],
    ]);
  });

  it('keys each tile by its league, so a sport-wide type shown under two leagues is two tiles', () => {
    const golf = buildLeagueContestCatalog(TEMPLATES, LEAGUES).find(({ sport }) => sport === 'GOLF')?.groups ?? [];
    const keys = golf.flatMap(({ tiles }) => tiles.map(({ key }) => key));

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('counts the contest types it lists for a sport, every league\'s tiles together', () => {
    const catalog = buildLeagueContestCatalog(TEMPLATES, LEAGUES);

    expect(catalog.map(({ sport, groups }) => [sport, contestTypeCount(groups)])).toEqual([['GOLF', 4], ['AMERICAN_FOOTBALL', 5]]);
  });

  it('gives the public page one tile per format for each sport, the most popular sport first, in the sport\'s format order, led by a default, with no variations', () => {
    const catalog = buildPublicContestCatalog(TEMPLATES, []);

    expect(catalog.map(({ sport, groups }) => [sport, groups.map(({ featured, variations }) => [featured.templateKey, variations.length])])).toEqual([
      ['AMERICAN_FOOTBALL', [['cfp-tiered-doubling', 0], ['nfl-survivor', 0], ['nfl-squares', 0]]],
      ['GOLF', [['golf-tiered-pick-6', 0], ['golf-budget-pick-6-best-4', 0]]],
    ]);
  });

  it('lists the public page\'s sports with the major team sports first and cycling and running last', () => {
    const sports = ['RUNNING', 'CYCLING', 'GOLF', 'BASEBALL', 'BASKETBALL', 'AMERICAN_FOOTBALL'] as const;
    const catalog = buildPublicContestCatalog(sports.map((sport) => template(`${sport}-tiered`, { sport, sportLeagueId: null, eventType: null })), []);

    expect(catalog.map(({ sport }) => sport)).toEqual(['AMERICAN_FOOTBALL', 'BASKETBALL', 'BASEBALL', 'GOLF', 'CYCLING', 'RUNNING']);
  });

  it('lists a sport\'s leagues on the public page in their display order, the NFL before the College Football Playoff, with unordered leagues after them by name', () => {
    const everyFootballLeague = template('football-pickem', { sportLeagueId: null, eventType: 'WEEK', selectionType: 'PICK_EM' });
    const catalog = buildPublicContestCatalog([...TEMPLATES, everyFootballLeague], [
      sportLeagueFixture({ id: CFP, sport: 'AMERICAN_FOOTBALL', name: 'College Football Playoff', displayOrder: 20 }),
      sportLeagueFixture({ id: XFL, sport: 'AMERICAN_FOOTBALL', name: 'XFL', displayOrder: null }),
      sportLeagueFixture({ id: 'arena', sport: 'AMERICAN_FOOTBALL', name: 'Arena League', displayOrder: null }),
      sportLeagueFixture({ id: NFL, sport: 'AMERICAN_FOOTBALL', name: 'NFL', displayOrder: 10 }),
    ]);

    expect(catalog.find(({ sport }) => sport === 'AMERICAN_FOOTBALL')?.leagues.map(({ name }) => name))
      .toEqual(['NFL', 'College Football Playoff', 'Arena League', 'XFL']);
  });

  it('gives the public page each sport\'s active leagues, named as they are beside other sports\' leagues, each with the formats it offers, its own templates leading its sport\'s', () => {
    const catalog = buildPublicContestCatalog(TEMPLATES, [
      sportLeagueFixture({ id: PGA, sport: 'GOLF', name: 'PGA TOUR' }),
      sportLeagueFixture({ id: LPGA, sport: 'GOLF', name: 'LPGA Tour' }),
      sportLeagueFixture({ id: NFL, sport: 'AMERICAN_FOOTBALL', name: 'NFL' }),
      sportLeagueFixture({ id: CFP, sport: 'AMERICAN_FOOTBALL', name: 'College Football Playoff', displayName: 'College Football' }),
      sportLeagueFixture({ id: XFL, sport: 'AMERICAN_FOOTBALL', name: 'XFL', isActive: false }),
    ]);

    expect(catalog.map(({ sport, leagues }) => [sport, leagues.map(({ name, slug, groups }) => [name, slug, groups.map(({ featured }) => featured.templateKey)])])).toEqual([
      ['AMERICAN_FOOTBALL', [
        ['College Football', 'college-football-playoff', ['cfp-tiered-doubling']],
        ['NFL', 'nfl', ['nfl-tiered-doubling', 'nfl-survivor', 'nfl-squares']],
      ]],
      ['GOLF', [
        ['LPGA Tour', 'lpga-tour', ['lpga-tour-majors-tiered', 'golf-budget-pick-6-best-4']],
        ['PGA TOUR', 'pga-tour', ['golf-tiered-pick-6', 'golf-budget-pick-6-best-4']],
      ]],
    ]);
  });

  it('leaves out of the public page a sport league that offers no format', () => {
    const catalog = buildPublicContestCatalog(TEMPLATES, [sportLeagueFixture({ id: XFL, sport: 'AMERICAN_FOOTBALL', name: 'XFL' })]);

    expect(catalog.find(({ sport }) => sport === 'AMERICAN_FOOTBALL')?.leagues).toEqual([]);
  });

  it('spells a name for the page\'s link in lower case with dashes and no accents', () => {
    expect(catalogSlug('NCAA Division I Men')).toBe('ncaa-division-i-men');
    expect(catalogSlug('Copa América')).toBe('copa-america');
    expect(catalogSlug('UCI Women\'s WorldTour')).toBe('uci-women-s-worldtour');
  });
});
