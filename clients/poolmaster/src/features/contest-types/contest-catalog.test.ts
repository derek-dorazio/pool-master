import { describe, expect, it } from 'vitest';
import type { ContestConfigTemplateDto } from '@/lib/api';
import { sportLeagueFixture } from '@/features/root-admin/sport-test-fixtures';
import { buildLeagueContestCatalog, buildPublicContestCatalog, catalogSlug } from './contest-catalog';

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
  } as ContestConfigTemplateDto;
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
  it('groups a league\'s templates by sport in the platform\'s order, every-event templates first and then each league by name', () => {
    const catalog = buildLeagueContestCatalog(TEMPLATES, new Map([[NFL, 'NFL'], [CFP, 'College Football Playoff'], [LPGA, 'LPGA Tour']]));

    expect(catalog.map(({ sport, groups }) => [sport, groups.map(({ name }) => name)])).toEqual([
      ['GOLF', ['Every tournament', 'LPGA Tour']],
      ['AMERICAN_FOOTBALL', ['College Football Playoff', 'NFL']],
    ]);
  });

  it('gives a league one tile per format and kind of event, led by its default, with the format\'s other templates as variations', () => {
    const catalog = buildLeagueContestCatalog(TEMPLATES, new Map([[NFL, 'NFL'], [CFP, 'College Football Playoff']]));
    const nfl = catalog.find(({ sport }) => sport === 'AMERICAN_FOOTBALL')?.groups.find(({ name }) => name === 'NFL');

    expect(nfl?.tiles.map(({ featured, variations }) => [featured.templateKey, variations.map(({ templateKey }) => templateKey)])).toEqual([
      ['nfl-tiered-doubling', ['nfl-tiered-doubling-upset-bonus']],
      ['nfl-survivor', []],
      ['nfl-squares', []],
      ['nfl-playoff-survivor', []],
    ]);
  });

  it('leaves out a league it has no name for, rather than showing an unnamed group', () => {
    const catalog = buildLeagueContestCatalog(TEMPLATES, new Map([[NFL, 'NFL']]));

    expect(catalog.find(({ sport }) => sport === 'AMERICAN_FOOTBALL')?.groups.map(({ name }) => name)).toEqual(['NFL']);
    expect(catalog.find(({ sport }) => sport === 'GOLF')?.groups.map(({ name }) => name)).toEqual(['Every tournament']);
  });

  it('gives the public page one tile per format for each sport, in the sport\'s format order, led by a default, with no variations', () => {
    const catalog = buildPublicContestCatalog(TEMPLATES, []);

    expect(catalog.map(({ sport, groups }) => [sport, groups.map(({ featured, variations }) => [featured.templateKey, variations.length])])).toEqual([
      ['GOLF', [['golf-tiered-pick-6', 0], ['golf-budget-pick-6-best-4', 0]]],
      ['AMERICAN_FOOTBALL', [['cfp-tiered-doubling', 0], ['nfl-survivor', 0], ['nfl-squares', 0]]],
    ]);
  });

  it('gives the public page each sport\'s active leagues by the name shown beside other sports\' leagues, each with the formats it offers, its own templates leading its sport\'s', () => {
    const catalog = buildPublicContestCatalog(TEMPLATES, [
      sportLeagueFixture({ id: PGA, sport: 'GOLF', name: 'PGA TOUR' }),
      sportLeagueFixture({ id: LPGA, sport: 'GOLF', name: 'LPGA Tour' }),
      sportLeagueFixture({ id: NFL, sport: 'AMERICAN_FOOTBALL', name: 'NFL' }),
      sportLeagueFixture({ id: CFP, sport: 'AMERICAN_FOOTBALL', name: 'College Football Playoff', displayName: 'College Football' }),
      sportLeagueFixture({ id: XFL, sport: 'AMERICAN_FOOTBALL', name: 'XFL', isActive: false }),
    ]);

    expect(catalog.map(({ sport, leagues }) => [sport, leagues.map(({ name, slug, groups }) => [name, slug, groups.map(({ featured }) => featured.templateKey)])])).toEqual([
      ['GOLF', [
        ['LPGA Tour', 'lpga-tour', ['lpga-tour-majors-tiered', 'golf-budget-pick-6-best-4']],
        ['PGA TOUR', 'pga-tour', ['golf-tiered-pick-6', 'golf-budget-pick-6-best-4']],
      ]],
      ['AMERICAN_FOOTBALL', [
        ['College Football', 'college-football-playoff', ['cfp-tiered-doubling']],
        ['NFL', 'nfl', ['nfl-tiered-doubling', 'nfl-survivor', 'nfl-squares']],
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
