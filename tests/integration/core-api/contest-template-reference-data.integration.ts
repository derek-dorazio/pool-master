import {
  ContestRulesWithEntryLimitSchema,
  SelectionType,
  Sport,
  assertNever,
} from '@poolmaster/shared/domain';
import {
  cleanupTestData,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

// The contest templates the migrations seed, read back from real Postgres. A template with a
// sport league is offered only for that league's events, so a template pointing at a league of
// another sport would be offered nowhere it can be used: checked for every sport, so a mis-seeded
// row of any future sport fails here. Auto racing's series and their points presets (#624) are
// checked value by value. No mocks.

beforeAll(async () => {
  await setupIntegrationTests();
  // The cleanup every suite runs keeps a league that a template names, and its sport's row.
  await cleanupTestData();
});
afterAll(async () => {
  await teardownIntegrationTests();
});

const NASCAR_CUP_POINTS = [40, 35, ...Array.from({ length: 34 }, (_, index) => 34 - index), 1, 1, 1, 1];
const INDYCAR_POINTS = [
  50, 40, 35, 32, 30, 28, 26, 24, 22, 20,
  ...Array.from({ length: 14 }, (_, index) => 19 - index),
  ...Array.from({ length: 9 }, () => 5),
];

async function leagueTemplates() {
  return getPrisma().contestConfigTemplate.findMany({
    where: { sportLeagueId: { not: null } },
    include: { sportLeague: { include: { sport: true } } },
    orderBy: [{ sportLeagueId: 'asc' }, { sortOrder: 'asc' }],
  });
}

describe('Seeded contest templates and their sport leagues', () => {
  it('puts every template that has a sport league in a league of the template\'s own sport', async () => {
    const templates = await leagueTemplates();

    expect(templates.length).toBeGreaterThan(0);
    const misplaced = templates
      .filter((template) => template.sportLeague?.sport.sport !== template.sport)
      .map((template) => `${template.templateKey}: ${template.sport} template in a ${template.sportLeague?.sport.sport} league`);
    expect(misplaced).toEqual([]);
  });

  it('gives no sport league more than one default template per contest format', async () => {
    const templates = await leagueTemplates();
    const defaults = new Map<string, number>();
    for (const template of templates.filter((candidate) => candidate.isDefault && candidate.active)) {
      const scope = `${template.sportLeague?.name} ${template.contestFormat}`;
      defaults.set(scope, (defaults.get(scope) ?? 0) + 1);
    }

    expect([...defaults].filter(([, count]) => count > 1)).toEqual([]);
  });

  it('seeds auto racing\'s two series, each with a tiered default, a budget and a random-draw template of its own', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sport: Sport.AUTO_RACING },
      include: { sportLeague: { include: { sport: true } } },
      orderBy: [{ templateKey: 'asc' }],
    });

    expect(templates.map((template) => [
      template.sportLeague?.name,
      template.templateKey,
      template.selectionType,
      template.isDefault,
      template.active,
    ])).toEqual([
      ['IndyCar', 'indycar-budget-points', SelectionType.BUDGET_PICK, false, true],
      ['IndyCar', 'indycar-random-draw-points', SelectionType.RANDOM_DRAW, false, true],
      ['IndyCar', 'indycar-tiered-points', SelectionType.TIERED, true, true],
      ['NASCAR Cup Series', 'nascar-cup-budget-points', SelectionType.BUDGET_PICK, false, true],
      ['NASCAR Cup Series', 'nascar-cup-random-draw-points', SelectionType.RANDOM_DRAW, false, true],
      ['NASCAR Cup Series', 'nascar-cup-tiered-points', SelectionType.TIERED, true, true],
    ]);
    expect(new Set(templates.map((template) => template.sportLeague?.sport.sport))).toEqual(new Set([Sport.AUTO_RACING]));
  });

  it('presets NASCAR Cup Series points over 40 places and IndyCar points over 33, each a valid template configuration', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sport: Sport.AUTO_RACING },
      include: { sportLeague: true },
    });

    expect(NASCAR_CUP_POINTS).toHaveLength(40);
    expect(INDYCAR_POINTS).toHaveLength(33);
    for (const template of templates) {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      expect(rules.selectionType).toBe(template.selectionType);
      expect(rules.maxEntriesPerSquad).toBe(1);
      expect(rules.scoring).toEqual({
        participantScoringDefinitionId: 'FINISH_POSITION_POINTS',
        config: {
          pointsTable: template.sportLeague?.name === 'IndyCar' ? INDYCAR_POINTS : NASCAR_CUP_POINTS,
          didNotFinishPoints: 0,
        },
      });
    }
  });

  it('counts five drivers in the tiered and budget presets and one in the random draw', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sport: Sport.AUTO_RACING },
      orderBy: { templateKey: 'asc' },
    });

    const shapes = templates.map((template) => {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      switch (rules.selectionType) {
        case SelectionType.TIERED:
          return [template.templateKey, rules.picksPerTier, rules.countedScores];
        case SelectionType.BUDGET_PICK:
          return [template.templateKey, rules.rosterSize, rules.countedScores];
        case SelectionType.RANDOM_DRAW:
          return [template.templateKey, rules.picksPerEntry, rules.countedScores];
        default:
          return assertNever(rules, 'selection type');
      }
    });

    expect(shapes).toEqual([
      ['indycar-budget-points', 5, 5],
      ['indycar-random-draw-points', 1, 1],
      ['indycar-tiered-points', 1, 5],
      ['nascar-cup-budget-points', 5, 5],
      ['nascar-cup-random-draw-points', 1, 1],
      ['nascar-cup-tiered-points', 1, 5],
    ]);
  });
});
