import { describe, expect, it } from 'vitest';
import type { ContestConfigTemplateDto } from '@/lib/api';
import { buildLeagueContestCatalog, buildPublicContestCatalog } from './contest-catalog';

const NFL = '80300000-0000-4000-8000-000000000001';
const CFP = '80300000-0000-4000-8000-000000000002';
const LPGA = '80300000-0000-4000-8000-000000000003';

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
    const catalog = buildPublicContestCatalog(TEMPLATES);

    expect(catalog.map(({ sport, groups }) => [sport, groups.map(({ featured, variations }) => [featured.templateKey, variations.length])])).toEqual([
      ['GOLF', [['golf-tiered-pick-6', 0], ['golf-budget-pick-6-best-4', 0]]],
      ['AMERICAN_FOOTBALL', [['cfp-tiered-doubling', 0], ['nfl-survivor', 0], ['nfl-squares', 0]]],
    ]);
  });
});
