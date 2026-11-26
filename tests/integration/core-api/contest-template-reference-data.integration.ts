import {
  ContestFormat,
  ContestRulesWithEntryLimitSchema,
  LeaguePhase,
  SlotKind,
  TemplateCoverageMode,
  PARTICIPANT_SCORING_SETTINGS_SCHEMAS,
  SUPPORTED_SPORTS,
  SelectionType,
  Sport,
  assertNever,
  getSportDefinition,
  getTieredRosterSize,
  getTiersInPlay,
  isRosterSelectionType,
  sportAllowsSelectionType,
  definitionPlaysMatches,
  sportLeagueDefinitionOf,
  templateCoverageProblem,
} from '@poolmaster/shared/domain';
import {
  cleanupTestData,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaContestConfigTemplateRepository, PrismaSportLeagueRepository } from '../../../packages/core-api/src/adapters';
import { isTestSlate, parseSportDataFile } from '../../../packages/core-api/scripts/seed-golf/sport-data-file';

// The contest templates the migrations seed, read back from real Postgres. A template with a
// sport league is offered only for that league's events, so a template pointing at a league of
// another sport would be offered nowhere it can be used: checked for every sport, so a mis-seeded
// row of any future sport fails here. Auto racing's series and their points presets (#624, and
// Formula 1 in #625) are checked value by value, and every sport's presets, golf and horse racing
// included, against the rules contest creation holds them to. No mocks.

// Only a sport with a scoring definition can host a contest, so only it is owed presets.
/**
 * The tiered templates with no budget twin yet (#2160), by league URL segment and key. Shrink-only: the data change that
 * adds a league's budget twins removes its keys here, and nothing is ever added.
 */
const TIERED_TEMPLATES_WITHOUT_BUDGET_TWIN: string[] = [
  'atp/atp-tiered-best-four-doubling',
  'atp/atp-tiered-seeds-only-doubling',
  'copa-america/copa-america-tiered-doubling',
  'copa-america/copa-america-tiered-doubling-upset-bonus',
  'f1/formula-1-tiered-points',
  'lpga/golf-tiered-pick-12',
  'lpga/golf-tiered-top-four-tiers',
  'ncaamf/cfp-tiered-doubling',
  'ncaamf/cfp-tiered-doubling-upset-bonus',
  'ncaamt/ncaa-men-tennis-tiered-best-four-doubling',
  'ncaawh/ncaa-women-hockey-tiered-doubling',
  'ncaawh/ncaa-women-hockey-tiered-doubling-upset-bonus',
  'ncaawt/ncaa-women-tennis-tiered-best-four-doubling',
  'nwsl/nwsl-tiered-doubling',
  'nwsl/nwsl-tiered-doubling-upset-bonus',
  'pga/golf-tiered-pick-12',
  'pga/golf-tiered-top-four-tiers',
  'wnba/wnba-tiered-doubling',
  'wnba/wnba-tiered-doubling-upset-bonus',
  'wta/wta-tiered-best-four-doubling',
  'wta/wta-tiered-seeds-only-doubling',
];

const SCORED_SPORTS = SUPPORTED_SPORTS.filter((sport) => getSportDefinition(sport).scoringDefinitions.length > 0);

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
const FORMULA_1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const POINTS_BY_SERIES: Record<string, number[]> = {
  'NASCAR Cup Series': NASCAR_CUP_POINTS,
  IndyCar: INDYCAR_POINTS,
  'Formula 1': FORMULA_1_POINTS,
};

describe('Seeded contest templates and their sport leagues', () => {
  it('seeds auto racing\'s three series, each with a budget, a tiered and a random-draw template of its own, every one the default of its format', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.AUTO_RACING } } },
      include: { sportLeague: { include: { sport: true } } },
      orderBy: [{ templateKey: 'asc' }],
    });

    expect(templates.map((template) => [
      template.sportLeague.name,
      template.templateKey,
      template.selectionType,
      template.isDefault,
      template.active,
    ])).toEqual([
      ['Formula 1', 'formula-1-budget-points', SelectionType.BUDGET_PICK, true, true],
      ['Formula 1', 'formula-1-random-draw-points', SelectionType.RANDOM_DRAW, true, true],
      ['Formula 1', 'formula-1-tiered-points', SelectionType.TIERED, true, true],
      ['IndyCar', 'indycar-budget-points', SelectionType.BUDGET_PICK, true, true],
      ['IndyCar', 'indycar-random-draw-points', SelectionType.RANDOM_DRAW, true, true],
      ['IndyCar', 'indycar-tiered-points', SelectionType.TIERED, true, true],
      ['NASCAR Cup Series', 'nascar-cup-budget-points', SelectionType.BUDGET_PICK, true, true],
      ['NASCAR Cup Series', 'nascar-cup-random-draw-points', SelectionType.RANDOM_DRAW, true, true],
      ['NASCAR Cup Series', 'nascar-cup-tiered-points', SelectionType.TIERED, true, true],
    ]);
    expect(new Set(templates.map((template) => template.sportLeague.sport.sport))).toEqual(new Set([Sport.AUTO_RACING]));
  });

  it('sorts the Formula 1 budget default first among the Formula 1 templates', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.AUTO_RACING }, name: 'Formula 1' } },
      orderBy: { sortOrder: 'asc' },
    });

    expect(templates.map((template) => template.templateKey)).toEqual([
      'formula-1-budget-points',
      'formula-1-tiered-points',
      'formula-1-random-draw-points',
    ]);
  });

  it('presets NASCAR Cup Series points over 40 places, IndyCar points over 33 and Formula 1 points over 10, each a valid template configuration', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.AUTO_RACING } } },
      include: { sportLeague: true },
    });

    expect(NASCAR_CUP_POINTS).toHaveLength(40);
    expect(INDYCAR_POINTS).toHaveLength(33);
    expect(FORMULA_1_POINTS).toHaveLength(10);
    expect(new Set(templates.map((template) => template.sportLeague.name)))
      .toEqual(new Set(Object.keys(POINTS_BY_SERIES)));
    for (const template of templates) {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      expect(rules.selectionType).toBe(template.selectionType);
      expect(rules.maxEntriesPerSquad).toBe(1);
      expect(rules.scoring).toEqual({
        participantScoringDefinitionId: 'FINISH_POSITION_POINTS',
        config: {
          pointsTable: POINTS_BY_SERIES[template.sportLeague.name],
          didNotFinishPoints: 0,
        },
      });
    }
  });

  it('counts five drivers in the budget presets, five in the NASCAR and IndyCar tiered presets, four in the Formula 1 tiered preset and one in the random draw', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.AUTO_RACING } } },
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
        case SelectionType.PICK_EM:
          // A pick'em preset picks games, not a lineup, so it counts no scores.
          return [template.templateKey, rules.mode];
        case SelectionType.BRACKET:
          // A bracket preset picks every game to the final: no lineup, no counted scores.
          return [template.templateKey, rules.selectionType];
        case SelectionType.SURVIVOR:
          // A survivor preset picks one team a week: no lineup, no counted scores.
          return [template.templateKey, rules.selectionType];
        case SelectionType.SQUARES:
          // A squares preset claims boxes of a grid: no lineup, no counted scores.
          return [template.templateKey, rules.maxSquaresPerEntry];
        default:
          return assertNever(rules, 'selection type');
      }
    });

    expect(shapes).toEqual([
      ['formula-1-budget-points', 5, 5],
      ['formula-1-random-draw-points', 1, 1],
      ['formula-1-tiered-points', 1, 4],
      ['indycar-budget-points', 5, 5],
      ['indycar-random-draw-points', 1, 1],
      ['indycar-tiered-points', 1, 5],
      ['nascar-cup-budget-points', 5, 5],
      ['nascar-cup-random-draw-points', 1, 1],
      ['nascar-cup-tiered-points', 1, 5],
    ]);
  });
});

// No multi-tournament field pools (#2010, ADR 0014): the majors and Grand Slam pools are deleted;
// a league runs one contest per major and the Majors or Grand Slam Cup adds them up.
describe('Seeded multi-tournament pools', () => {
  it('seeds no majors pool on the PGA TOUR or the LPGA Tour and no Grand Slams pool on the ATP or the WTA', async () => {
    await expect(getPrisma().contestConfigTemplate.count({
      where: { templateKey: { in: ['pga-tour-majors-tiered', 'lpga-tour-majors-tiered', 'atp-slams-tiered-doubling', 'wta-slams-tiered-doubling'] } },
    })).resolves.toBe(0);
  });
});

// Cycling's tours and their Top 10 presets (#626), checked value by value.
const CYCLING_TOP_10_POINTS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

describe('Golf and horse racing setups, one copy per sport league', () => {
  it('gives PGA TOUR and LPGA Tour each their own copy of golf\'s seven every-event setups, with the same keys and rules and three defaults each, so a change to one league\'s setup leaves the other\'s alone', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.GOLF } }, active: true },
      include: { sportLeague: true },
      orderBy: [{ sortOrder: 'asc' }],
    });
    const byLeague = (name: string) => templates.filter((template) => template.sportLeague.name === name);
    const shape = (template: (typeof templates)[number]) => [template.templateKey, template.isDefault, template.configJson];

    expect(byLeague('PGA TOUR').map((template) => template.templateKey)).toEqual([
      'golf-tiered-pick-6',
      'golf-tiered-pick-12',
      'golf-tiered-top-four-tiers',
      'golf-budget-pick-6-best-4',
      'golf-budget-pick-6-all-count',
      'golf-random-draw-1',
      'golf-random-draw-3-best-2',
    ]);
    expect(byLeague('LPGA Tour').map(shape)).toEqual(byLeague('PGA TOUR').map(shape));
    expect(byLeague('PGA TOUR').filter((template) => template.isDefault)).toHaveLength(3);
    expect(new Set(templates.map((template) => template.id)).size).toBe(14);
  });

  it('seeds golf\'s "Top four tiers" setup on each tour beside its default tiered one: one golfer from each of the first four tiers, all four count, not a default (#704)', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.GOLF } }, templateKey: 'golf-tiered-top-four-tiers' },
      include: { sportLeague: true },
      orderBy: { sportLeague: { name: 'asc' } },
    });

    expect(templates.map((template) => template.sportLeague.name)).toEqual(['LPGA Tour', 'PGA TOUR']);
    for (const template of templates) {
      expect(template).toMatchObject({
        isDefault: false,
        configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, tiersUsed: 4, countedScores: 4, maxEntriesPerSquad: 1 },
      });
    }
  });

  it('gives US Thoroughbred horse racing\'s three setups as its own, kept while the league is switched off, one default per way of picking', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.HORSE_RACING } } },
      include: { sportLeague: true },
      orderBy: [{ sortOrder: 'asc' }],
    });

    expect(templates.map((template) => [template.sportLeague.name, template.templateKey, template.isDefault])).toEqual([
      ['US Thoroughbred', 'horse-racing-tiered-win-place-show', true],
      ['US Thoroughbred', 'horse-racing-budget-win-place-show', true],
      ['US Thoroughbred', 'horse-racing-random-draw-win-place-show', true],
    ]);
  });
});

describe('Seeded cycling tours and their Top 10 templates', () => {
  it('seeds cycling\'s two tours, each with a tiered, a budget and a random-draw template of its own, every one the default of its format', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.CYCLING } } },
      include: { sportLeague: { include: { sport: true } } },
      orderBy: [{ templateKey: 'asc' }],
    });

    expect(templates.map((template) => [
      template.sportLeague.name,
      template.templateKey,
      template.selectionType,
      template.isDefault,
      template.active,
    ])).toEqual([
      ["UCI Women's WorldTour", 'uci-womens-worldtour-budget-top-10', SelectionType.BUDGET_PICK, true, true],
      ["UCI Women's WorldTour", 'uci-womens-worldtour-random-draw-top-10', SelectionType.RANDOM_DRAW, true, true],
      ["UCI Women's WorldTour", 'uci-womens-worldtour-tiered-top-10', SelectionType.TIERED, true, true],
      ['UCI WorldTour', 'uci-worldtour-budget-top-10', SelectionType.BUDGET_PICK, true, true],
      ['UCI WorldTour', 'uci-worldtour-random-draw-top-10', SelectionType.RANDOM_DRAW, true, true],
      ['UCI WorldTour', 'uci-worldtour-tiered-top-10', SelectionType.TIERED, true, true],
    ]);
    expect(new Set(templates.map((template) => template.sportLeague.sport.sport))).toEqual(new Set([Sport.CYCLING]));
  });

  it('presets Top 10 points (10 down to 1, 0 for an abandon) on every cycling template, each a valid template configuration', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({ where: { sportLeague: { sport: { sport: Sport.CYCLING } } } });

    expect(templates).toHaveLength(6);
    for (const template of templates) {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      expect(rules.selectionType).toBe(template.selectionType);
      expect(rules.maxEntriesPerSquad).toBe(1);
      expect(rules.scoring).toEqual({
        participantScoringDefinitionId: 'FINISH_POSITION_POINTS',
        config: { pointsTable: CYCLING_TOP_10_POINTS, didNotFinishPoints: 0 },
      });
    }
  });

  it('counts five riders in the tiered and budget presets and one in the random draw', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.CYCLING } } },
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
        case SelectionType.PICK_EM:
          // A pick'em preset picks games, not a lineup, so it counts no scores.
          return [template.templateKey, rules.mode];
        case SelectionType.BRACKET:
          // A bracket preset picks every game to the final: no lineup, no counted scores.
          return [template.templateKey, rules.selectionType];
        case SelectionType.SURVIVOR:
          // A survivor preset picks one team a week: no lineup, no counted scores.
          return [template.templateKey, rules.selectionType];
        case SelectionType.SQUARES:
          // A squares preset claims boxes of a grid: no lineup, no counted scores.
          return [template.templateKey, rules.maxSquaresPerEntry];
        default:
          return assertNever(rules, 'selection type');
      }
    });

    expect(shapes).toEqual([
      ['uci-womens-worldtour-budget-top-10', 5, 5],
      ['uci-womens-worldtour-random-draw-top-10', 1, 1],
      ['uci-womens-worldtour-tiered-top-10', 1, 5],
      ['uci-worldtour-budget-top-10', 5, 5],
      ['uci-worldtour-random-draw-top-10', 1, 1],
      ['uci-worldtour-tiered-top-10', 1, 5],
    ]);
  });
});

// Running's series and their Top 10 presets (#627), checked value by value.
const RUNNING_TOP_10_POINTS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

describe('Seeded running series and their Top 10 templates', () => {
  it('seeds running\'s two World Marathon Majors series, each with a tiered, a budget and a random-draw template of its own, every one the default of its format', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.RUNNING } } },
      include: { sportLeague: { include: { sport: true } } },
      orderBy: [{ templateKey: 'asc' }],
    });

    expect(templates.map((template) => [
      template.sportLeague.name,
      template.templateKey,
      template.selectionType,
      template.isDefault,
      template.active,
      template.name,
    ])).toEqual([
      ['World Marathon Majors (men)', 'wmm-men-budget-top-10', SelectionType.BUDGET_PICK, true, true, 'Budget: 4 runners under the cap, Top 10 points'],
      ['World Marathon Majors (men)', 'wmm-men-random-draw-top-10', SelectionType.RANDOM_DRAW, true, true, 'Quick pick: 1 runner each, Top 10 points'],
      ['World Marathon Majors (men)', 'wmm-men-tiered-top-10', SelectionType.TIERED, true, true, 'Tiered: 1 runner per tier, Top 10 points'],
      ['World Marathon Majors (women)', 'wmm-women-budget-top-10', SelectionType.BUDGET_PICK, true, true, 'Budget: 4 runners under the cap, Top 10 points'],
      ['World Marathon Majors (women)', 'wmm-women-random-draw-top-10', SelectionType.RANDOM_DRAW, true, true, 'Quick pick: 1 runner each, Top 10 points'],
      ['World Marathon Majors (women)', 'wmm-women-tiered-top-10', SelectionType.TIERED, true, true, 'Tiered: 1 runner per tier, Top 10 points'],
    ]);
    expect(new Set(templates.map((template) => template.sportLeague.sport.sport))).toEqual(new Set([Sport.RUNNING]));
  });

  it('presets Top 10 points (10 down to 1, 0 for a runner who drops out) on every running template, each a valid template configuration', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({ where: { sportLeague: { sport: { sport: Sport.RUNNING } } } });

    expect(templates).toHaveLength(6);
    for (const template of templates) {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      expect(rules.selectionType).toBe(template.selectionType);
      expect(rules.maxEntriesPerSquad).toBe(1);
      expect(rules.scoring).toEqual({
        participantScoringDefinitionId: 'FINISH_POSITION_POINTS',
        config: { pointsTable: RUNNING_TOP_10_POINTS, didNotFinishPoints: 0 },
      });
    }
  });

  it('counts four runners in the tiered (one from each of four tiers) and budget presets and one in the random draw', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.RUNNING } } },
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
        case SelectionType.PICK_EM:
          // A pick'em preset picks games, not a lineup, so it counts no scores.
          return [template.templateKey, rules.mode];
        case SelectionType.BRACKET:
          // A bracket preset picks every game to the final: no lineup, no counted scores.
          return [template.templateKey, rules.selectionType];
        case SelectionType.SURVIVOR:
          // A survivor preset picks one team a week: no lineup, no counted scores.
          return [template.templateKey, rules.selectionType];
        case SelectionType.SQUARES:
          // A squares preset claims boxes of a grid: no lineup, no counted scores.
          return [template.templateKey, rules.maxSquaresPerEntry];
        default:
          return assertNever(rules, 'selection type');
      }
    });

    expect(shapes).toEqual([
      ['wmm-men-budget-top-10', 4, 4],
      ['wmm-men-random-draw-top-10', 1, 1],
      ['wmm-men-tiered-top-10', 1, 4],
      ['wmm-women-budget-top-10', 4, 4],
      ['wmm-women-random-draw-top-10', 1, 1],
      ['wmm-women-tiered-top-10', 1, 4],
    ]);
  });
});

// The NCAA tournaments' knockout presets (#699), checked value by value.
const DOUBLING_ROUND_VALUES = [1, 2, 4, 8, 16, 32];

describe('Seeded NCAA basketball leagues and their knockout templates', () => {
  it('seeds both NCAA Division I leagues with a Doubling and a Doubling + upset bonus template for each roster selection type, the plain Doubling one each format\'s default', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.BASKETBALL } }, templateKey: { startsWith: 'ncaa-' }, contestFormat: ContestFormat.ROSTER },
      include: { sportLeague: { include: { sport: true } } },
      orderBy: [{ templateKey: 'asc' }],
    });

    expect(templates.map((template) => [
      template.sportLeague.name,
      template.templateKey,
      template.selectionType,
      template.isDefault,
      template.active,
    ])).toEqual([
      ['NCAA Men\'s Basketball', 'ncaa-men-budget-doubling', SelectionType.BUDGET_PICK, true, true],
      ['NCAA Men\'s Basketball', 'ncaa-men-budget-doubling-upset-bonus', SelectionType.BUDGET_PICK, false, true],
      ['NCAA Men\'s Basketball', 'ncaa-men-random-draw-doubling', SelectionType.RANDOM_DRAW, true, true],
      ['NCAA Men\'s Basketball', 'ncaa-men-random-draw-doubling-upset-bonus', SelectionType.RANDOM_DRAW, false, true],
      ['NCAA Men\'s Basketball', 'ncaa-men-tiered-doubling', SelectionType.TIERED, true, true],
      ['NCAA Men\'s Basketball', 'ncaa-men-tiered-doubling-upset-bonus', SelectionType.TIERED, false, true],
      ['NCAA Women\'s Basketball', 'ncaa-women-budget-doubling', SelectionType.BUDGET_PICK, true, true],
      ['NCAA Women\'s Basketball', 'ncaa-women-budget-doubling-upset-bonus', SelectionType.BUDGET_PICK, false, true],
      ['NCAA Women\'s Basketball', 'ncaa-women-random-draw-doubling', SelectionType.RANDOM_DRAW, true, true],
      ['NCAA Women\'s Basketball', 'ncaa-women-random-draw-doubling-upset-bonus', SelectionType.RANDOM_DRAW, false, true],
      ['NCAA Women\'s Basketball', 'ncaa-women-tiered-doubling', SelectionType.TIERED, true, true],
      ['NCAA Women\'s Basketball', 'ncaa-women-tiered-doubling-upset-bonus', SelectionType.TIERED, false, true],
    ]);
    expect(new Set(templates.map((template) => template.sportLeague.sport.sport))).toEqual(new Set([Sport.BASKETBALL]));
  });

  it('presets round values 1, 2, 4, 8, 16 and 32 on every roster and bracket template, with no upset bonus on Doubling and the seed difference times 1 on Doubling + upset bonus', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.BASKETBALL } }, templateKey: { startsWith: 'ncaa-' }, selectionType: { notIn: [SelectionType.SURVIVOR, SelectionType.SQUARES] } },
    });

    expect(templates).toHaveLength(18);
    for (const template of templates) {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      expect(rules.selectionType).toBe(template.selectionType);
      expect(rules.maxEntriesPerSquad).toBe(1);
      expect(rules.scoring).toEqual({
        participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
        config: {
          roundValues: DOUBLING_ROUND_VALUES,
          upsetBonus: template.templateKey.endsWith('-upset-bonus')
            ? { rule: 'SEED_DIFFERENCE', multiplier: 1 }
            : { rule: 'NONE' },
        },
      });
    }
  });
});

// Soccer's competitions (#787): each a fixed knockout bracket, its presets doubling up to its
// final. The Copa América starts at the quarter-finals; the Champions League at its knockout
// play-offs, naming its own rounds. MLS starts at its wild card round, the NWSL at its
// quarterfinals, and each NCAA tournament at its first round, all naming their own rounds.
const SOCCER_COMPETITIONS = [
  ['FIFA World Cup', 'world-cup', [1, 2, 4, 8], 4],
  ['FIFA Women\'s World Cup', 'womens-world-cup', [1, 2, 4, 8], 4],
  ['UEFA European Championship', 'euro', [1, 2, 4, 8], 4],
  ['Copa América', 'copa-america', [1, 2, 4], 3],
  ['UEFA Champions League', 'champions-league', [1, 2, 4, 8, 16], 4],
  ['MLS', 'mls', [1, 2, 4, 8, 16], 4],
  ['NWSL', 'nwsl', [1, 2, 4], 3],
  ['NCAA Men\'s Soccer', 'ncaa-men-soccer', [1, 2, 4, 8, 16, 32], 4],
  ['NCAA Women\'s Soccer', 'ncaa-women-soccer', [1, 2, 4, 8, 16, 32], 4],
] as const;

describe('Seeded soccer competitions and their knockout templates', () => {
  it('seeds the nine competitions as fixed brackets, the international ones reading the sport\'s round names, and the Premier League, played in weeks, read back through the sport league repository', async () => {
    const soccer = await getPrisma().sport.findUniqueOrThrow({ where: { sport: Sport.SOCCER } });
    const leagues = await new PrismaSportLeagueRepository(getAppPrisma()).findAll({ sportId: soccer.id });
    const ncaaRounds = ['First Round', 'Second Round', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Final'];

    expect(leagues.map((league) => [league.name, league.bracketAdvancement, league.roundNames])).toEqual([
      ['Copa América', 'FIXED', []],
      ['FIFA Women\'s World Cup', 'FIXED', []],
      ['FIFA World Cup', 'FIXED', []],
      ['MLS', 'FIXED', ['Wild Card', 'Round One', 'Conference Semifinals', 'Conference Finals', 'MLS Cup']],
      ['NCAA Men\'s Soccer', 'FIXED', ncaaRounds],
      ['NCAA Women\'s Soccer', 'FIXED', ncaaRounds],
      ['NWSL', 'FIXED', ['Quarterfinals', 'Semifinals', 'Championship']],
      ['Premier League', 'FIXED', []],
      ['UEFA Champions League', 'FIXED', ['Knockout phase play-offs', 'Round of 16', 'Quarter-finals', 'Semi-finals', 'Final']],
      ['UEFA European Championship', 'FIXED', []],
    ]);
  });

  it('starts squares at the Champions League final and the MLS conference semifinals, past their two-legged ties and best-of-three series, and every other soccer league at its first round', async () => {
    const soccer = await getPrisma().sport.findUniqueOrThrow({ where: { sport: Sport.SOCCER } });
    const leagues = await new PrismaSportLeagueRepository(getAppPrisma()).findAll({ sportId: soccer.id });

    expect(leagues.filter((league) => league.squaresFromRound !== null).map((league) => [league.name, league.squaresFromRound]))
      .toEqual([['MLS', 3], ['UEFA Champions League', 5]]);
  });

  it.each(SOCCER_COMPETITIONS)('gives %s eleven knockout templates, one default per format, every roster and bracket preset doubling from 1 to its final', async (name, prefix, roundValues, budgetRoster) => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.SOCCER }, name }, slots: { some: { definition: { slotKind: { not: SlotKind.WEEK } } } } },
      orderBy: [{ sortOrder: 'asc' }],
    });

    expect(templates.map((template) => [template.templateKey, template.selectionType, template.coverageMode, template.isDefault])).toEqual([
      [`${prefix}-tiered-doubling`, SelectionType.TIERED, TemplateCoverageMode.ALL_LISTED, true],
      [`${prefix}-tiered-doubling-upset-bonus`, SelectionType.TIERED, TemplateCoverageMode.ALL_LISTED, false],
      [`${prefix}-budget-doubling`, SelectionType.BUDGET_PICK, TemplateCoverageMode.ALL_LISTED, true],
      [`${prefix}-budget-doubling-upset-bonus`, SelectionType.BUDGET_PICK, TemplateCoverageMode.ALL_LISTED, false],
      [`${prefix}-random-draw-doubling`, SelectionType.RANDOM_DRAW, TemplateCoverageMode.ALL_LISTED, true],
      [`${prefix}-random-draw-doubling-upset-bonus`, SelectionType.RANDOM_DRAW, TemplateCoverageMode.ALL_LISTED, false],
      [`${prefix}-bracket-doubling`, SelectionType.BRACKET, TemplateCoverageMode.ALL_LISTED, true],
      [`${prefix}-bracket-doubling-upset-bonus`, SelectionType.BRACKET, TemplateCoverageMode.ALL_LISTED, false],
      [`${prefix}-bracket-second-chance-doubling`, SelectionType.BRACKET, TemplateCoverageMode.ALL_LISTED, false],
      [`${prefix}-squares`, SelectionType.SQUARES, TemplateCoverageMode.ONE_SLOT, true],
      [`${prefix}-knockout-survivor`, SelectionType.SURVIVOR, TemplateCoverageMode.FROM_SLOT, true],
    ]);
    for (const template of templates) {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      if (rules.selectionType === SelectionType.SQUARES || rules.selectionType === SelectionType.SURVIVOR) continue;
      expect(rules.scoring).toEqual({
        participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
        config: {
          roundValues,
          upsetBonus: template.templateKey.endsWith('-upset-bonus') ? { rule: 'SEED_DIFFERENCE', multiplier: 1 } : { rule: 'NONE' },
        },
      });
      if (rules.selectionType === SelectionType.BUDGET_PICK) expect([rules.rosterSize, rules.countedScores]).toEqual([budgetRoster, budgetRoster]);
      if (rules.selectionType === SelectionType.BRACKET) expect(rules.startsAtRound).toBe(template.templateKey.includes('second-chance') ? 2 : 1);
    }
  });
});

// League seasons and group matchdays (#787): a week of games is a week event, as an NFL week is.
describe('Seeded soccer week templates', () => {
  it('gives the Premier League pick\'em straight up and confidence on draw-pick weeks and Last Man Standing, whose teams can be picked again once all 20 are used', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.SOCCER }, name: 'Premier League' } },
      orderBy: [{ sortOrder: 'asc' }],
    });

    expect(templates.map((template) => [template.templateKey, template.selectionType, template.coverageMode, template.isDefault, template.configJson])).toEqual([
      ['premier-league-pick-em-straight-up', SelectionType.PICK_EM, TemplateCoverageMode.ONE_SLOT, true, { selectionType: 'PICK_EM', mode: 'STRAIGHT_UP', againstTheSpread: false, maxEntriesPerSquad: 1 }],
      ['premier-league-pick-em-confidence', SelectionType.PICK_EM, TemplateCoverageMode.ONE_SLOT, false, { selectionType: 'PICK_EM', mode: 'CONFIDENCE', againstTheSpread: false, maxEntriesPerSquad: 1 }],
      ['premier-league-survivor', SelectionType.SURVIVOR, TemplateCoverageMode.FROM_SLOT, true, { selectionType: 'SURVIVOR', reuseTeamsOnceAllUsed: true, maxEntriesPerSquad: 1 }],
    ]);
    expect(templates.map((template) => template.description).join(' ')).toMatch(/or a draw/);
  });

  it.each(SOCCER_COMPETITIONS.filter(([name]) => ['FIFA World Cup', 'FIFA Women\'s World Cup', 'UEFA European Championship', 'Copa América', 'UEFA Champions League'].includes(name)))(
    'gives %s pick\'em for its group matchdays, straight up the default, covering its matchday slots, and no matchday survivor',
    async (name, prefix) => {
      const templates = await getPrisma().contestConfigTemplate.findMany({
        where: { sportLeague: { sport: { sport: Sport.SOCCER }, name }, templateKey: { contains: 'matchday' } },
        include: { slots: true },
        orderBy: [{ sortOrder: 'asc' }],
      });

      // Each covers the competition's WEEK slots, its matchdays (#2010): none yet where the
      // tournament has no matchday definitions, every one where it has them.
      const matchdays = await getPrisma().sportLeagueCompetitionSlot.count({ where: { sportLeague: { sport: { sport: Sport.SOCCER }, name }, slotKind: SlotKind.WEEK } });
      expect(templates.map((template) => [template.templateKey, template.selectionType, template.isDefault, template.slots.length])).toEqual([
        [`${prefix}-matchday-pick-em-straight-up`, SelectionType.PICK_EM, true, matchdays],
        [`${prefix}-matchday-pick-em-confidence`, SelectionType.PICK_EM, false, matchdays],
      ]);
    },
  );
});

// Tennis (#704): the ATP and the WTA, each a fixed knockout draw of seven rounds, their presets
// doubling to 64 in the final, each on one tournament at a time (#2010); and the NCAA singles
// championships, draws of six rounds doubling to 32.
const TENNIS_ROUND_VALUES = [1, 2, 4, 8, 16, 32, 64];

describe('Seeded tennis tours and their knockout templates', () => {
  it('seeds the ATP and the WTA as fixed brackets on the sport\'s own round names and tiers, and the NCAA singles championships on the NCAA\'s round names, read back through the sport league repository', async () => {
    const tennis = await getPrisma().sport.findUniqueOrThrow({ where: { sport: Sport.TENNIS } });
    const leagues = await new PrismaSportLeagueRepository(getAppPrisma()).findAll({ sportId: tennis.id });
    const ncaaRounds = ['First Round', 'Second Round', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Final'];

    expect(new Set(leagues.map((league) => league.participantType))).toEqual(new Set(['INDIVIDUAL']));
    const platformTierProfileCodes = new Map((await getPrisma().platformTierProfile.findMany()).map((profile) => [profile.id, profile.code]));
    expect(leagues.map((league) => [league.name, league.bracketAdvancement, league.roundNames, platformTierProfileCodes.get(league.platformTierProfileId)])).toEqual([
      ['ATP', 'FIXED', [], 'TIERS_6_OF_8'],
      ['NCAA Men\'s Tennis', 'FIXED', ncaaRounds, 'TIERS_6_OF_8'],
      ['NCAA Women\'s Tennis', 'FIXED', ncaaRounds, 'TIERS_6_OF_8'],
      ['WTA', 'FIXED', [], 'TIERS_6_OF_8'],
    ]);
  });

  it.each([['ATP', 'atp'], ['WTA', 'wta']] as const)('gives the %s twelve knockout templates, each on one Grand Slam or tour event at a time, one default per format, with Seeds only picking from the first four tiers and the second-week bracket starting at the fourth round', async (name, prefix) => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.TENNIS }, name } },
      orderBy: [{ sortOrder: 'asc' }],
    });

    expect(templates.map((template) => [template.templateKey, template.selectionType, template.coverageMode, template.isDefault])).toEqual([
      [`${prefix}-tiered-doubling`, SelectionType.TIERED, TemplateCoverageMode.ONE_SLOT, true],
      [`${prefix}-tiered-doubling-upset-bonus`, SelectionType.TIERED, TemplateCoverageMode.ONE_SLOT, false],
      [`${prefix}-tiered-seeds-only-doubling`, SelectionType.TIERED, TemplateCoverageMode.ONE_SLOT, false],
      [`${prefix}-tiered-best-four-doubling`, SelectionType.TIERED, TemplateCoverageMode.ONE_SLOT, false],
      [`${prefix}-budget-doubling`, SelectionType.BUDGET_PICK, TemplateCoverageMode.ONE_SLOT, true],
      [`${prefix}-budget-doubling-upset-bonus`, SelectionType.BUDGET_PICK, TemplateCoverageMode.ONE_SLOT, false],
      [`${prefix}-random-draw-doubling`, SelectionType.RANDOM_DRAW, TemplateCoverageMode.ONE_SLOT, true],
      [`${prefix}-random-draw-doubling-upset-bonus`, SelectionType.RANDOM_DRAW, TemplateCoverageMode.ONE_SLOT, false],
      [`${prefix}-bracket-doubling`, SelectionType.BRACKET, TemplateCoverageMode.ONE_SLOT, true],
      [`${prefix}-bracket-doubling-upset-bonus`, SelectionType.BRACKET, TemplateCoverageMode.ONE_SLOT, false],
      [`${prefix}-bracket-second-week-doubling`, SelectionType.BRACKET, TemplateCoverageMode.ONE_SLOT, false],
      [`${prefix}-knockout-survivor`, SelectionType.SURVIVOR, TemplateCoverageMode.FROM_SLOT, true],
    ]);
    for (const template of templates) {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      if (rules.selectionType === SelectionType.SURVIVOR) continue;
      expect(rules.scoring).toEqual({
        participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
        config: {
          roundValues: TENNIS_ROUND_VALUES,
          upsetBonus: template.templateKey.endsWith('-upset-bonus') ? { rule: 'SEED_DIFFERENCE', multiplier: 1 } : { rule: 'NONE' },
        },
      });
      if (rules.selectionType === SelectionType.TIERED) {
        const seedsOnly = template.templateKey.includes('seeds-only');
        expect([rules.tiersUsed, rules.countedScores]).toEqual(seedsOnly ? [4, 4] : [undefined, template.templateKey.includes('best-four') ? 4 : 6]);
      }
      if (rules.selectionType === SelectionType.BUDGET_PICK) expect([rules.rosterSize, rules.countedScores]).toEqual([6, 6]);
      if (rules.selectionType === SelectionType.BRACKET) expect(rules.startsAtRound).toBe(template.templateKey.includes('second-week') ? 4 : 1);
    }
  });

  it.each([['NCAA Men\'s Tennis', 'ncaa-men-tennis'], ['NCAA Women\'s Tennis', 'ncaa-women-tennis']] as const)('gives %s ten knockout templates, one default per format, each roster and bracket preset doubling from 1 to 32 in the six-round draw\'s final', async (name, prefix) => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.TENNIS }, name } },
      orderBy: [{ sortOrder: 'asc' }],
    });

    expect(templates.map((template) => [template.templateKey, template.selectionType, template.coverageMode, template.isDefault])).toEqual([
      [`${prefix}-tiered-doubling`, SelectionType.TIERED, TemplateCoverageMode.ALL_LISTED, true],
      [`${prefix}-tiered-doubling-upset-bonus`, SelectionType.TIERED, TemplateCoverageMode.ALL_LISTED, false],
      [`${prefix}-tiered-best-four-doubling`, SelectionType.TIERED, TemplateCoverageMode.ALL_LISTED, false],
      [`${prefix}-budget-doubling`, SelectionType.BUDGET_PICK, TemplateCoverageMode.ALL_LISTED, true],
      [`${prefix}-budget-doubling-upset-bonus`, SelectionType.BUDGET_PICK, TemplateCoverageMode.ALL_LISTED, false],
      [`${prefix}-random-draw-doubling`, SelectionType.RANDOM_DRAW, TemplateCoverageMode.ALL_LISTED, true],
      [`${prefix}-random-draw-doubling-upset-bonus`, SelectionType.RANDOM_DRAW, TemplateCoverageMode.ALL_LISTED, false],
      [`${prefix}-bracket-doubling`, SelectionType.BRACKET, TemplateCoverageMode.ALL_LISTED, true],
      [`${prefix}-bracket-doubling-upset-bonus`, SelectionType.BRACKET, TemplateCoverageMode.ALL_LISTED, false],
      [`${prefix}-knockout-survivor`, SelectionType.SURVIVOR, TemplateCoverageMode.FROM_SLOT, true],
    ]);
    for (const template of templates) {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      if (rules.selectionType === SelectionType.SURVIVOR) continue;
      expect(rules.scoring).toEqual({
        participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
        config: {
          roundValues: [1, 2, 4, 8, 16, 32],
          upsetBonus: template.templateKey.endsWith('-upset-bonus') ? { rule: 'SEED_DIFFERENCE', multiplier: 1 } : { rule: 'NONE' },
        },
      });
      if (rules.selectionType === SelectionType.TIERED) expect(rules.countedScores).toBe(template.templateKey.includes('best-four') ? 4 : 6);
      if (rules.selectionType === SelectionType.BUDGET_PICK) expect([rules.rosterSize, rules.countedScores]).toEqual([6, 6]);
      if (rules.selectionType === SelectionType.BRACKET) expect(rules.startsAtRound).toBe(1);
    }
  });
});

// The NFL's knockout presets (#702): four playoff rounds, so the doubling stops at 8.
describe('The seeded NFL league and its knockout templates', () => {
  it('seeds the NFL, which reseeds, with a Doubling and a Doubling + upset bonus random draw, and one pick-3 tiered and one pick-3 budget template (#2160), all on round values 1, 2, 4, 8 and each format\'s plain one its default', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.FOOTBALL } }, templateKey: { startsWith: 'nfl-' }, contestFormat: ContestFormat.ROSTER },
      include: { sportLeague: true },
      orderBy: [{ templateKey: 'asc' }],
    });

    expect(new Set(templates.map((template) => [template.sportLeague.name, template.sportLeague.bracketAdvancement].join(' ')))).toEqual(new Set(['NFL RESEED_BY_SEED']));
    expect(templates.map((template) => [template.templateKey, template.selectionType, template.isDefault])).toEqual([
      ['nfl-budget-pick-3', SelectionType.BUDGET_PICK, true],
      ['nfl-random-draw-doubling', SelectionType.RANDOM_DRAW, true],
      ['nfl-random-draw-doubling-upset-bonus', SelectionType.RANDOM_DRAW, false],
      ['nfl-tiered-pick-3', SelectionType.TIERED, true],
    ]);
    for (const template of templates) {
      expect(ContestRulesWithEntryLimitSchema.parse(template.configJson).scoring).toEqual({
        participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
        config: {
          roundValues: [1, 2, 4, 8],
          upsetBonus: template.templateKey.endsWith('-upset-bonus') ? { rule: 'SEED_DIFFERENCE', multiplier: 1 } : { rule: 'NONE' },
        },
      });
    }
  });

  // Squares (#711, #786, #787): the NFL's, NCAA men's football's, each March Madness league's, each college hockey league's and each soccer league's squares preset, the default for its own format.
  it('seeds one squares template on the NFL, NCAA men\'s football, men\'s and women\'s March Madness, men\'s and women\'s college hockey and each soccer competition, ten boxes per entry and one entry per squad, each its league\'s default squares preset', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { contestFormat: ContestFormat.SQUARES },
      include: { sportLeague: { include: { sport: true } } },
      orderBy: { templateKey: 'asc' },
    });

    expect(templates.map((template) => [template.templateKey, template.sportLeague.sport.sport, template.selectionType, template.isDefault, template.sportLeague.name])).toEqual([
      ['cfp-squares', Sport.FOOTBALL, SelectionType.SQUARES, true, 'NCAA Men\'s Football'],
      ['champions-league-squares', Sport.SOCCER, SelectionType.SQUARES, true, 'UEFA Champions League'],
      ['copa-america-squares', Sport.SOCCER, SelectionType.SQUARES, true, 'Copa América'],
      ['euro-squares', Sport.SOCCER, SelectionType.SQUARES, true, 'UEFA European Championship'],
      ['mls-squares', Sport.SOCCER, SelectionType.SQUARES, true, 'MLS'],
      ['ncaa-men-hockey-squares', Sport.HOCKEY, SelectionType.SQUARES, true, 'NCAA Men\'s Hockey'],
      ['ncaa-men-soccer-squares', Sport.SOCCER, SelectionType.SQUARES, true, 'NCAA Men\'s Soccer'],
      ['ncaa-men-squares', Sport.BASKETBALL, SelectionType.SQUARES, true, 'NCAA Men\'s Basketball'],
      ['ncaa-women-hockey-squares', Sport.HOCKEY, SelectionType.SQUARES, true, 'NCAA Women\'s Hockey'],
      ['ncaa-women-soccer-squares', Sport.SOCCER, SelectionType.SQUARES, true, 'NCAA Women\'s Soccer'],
      ['ncaa-women-squares', Sport.BASKETBALL, SelectionType.SQUARES, true, 'NCAA Women\'s Basketball'],
      ['nfl-squares', Sport.FOOTBALL, SelectionType.SQUARES, true, 'NFL'],
      ['nwsl-squares', Sport.SOCCER, SelectionType.SQUARES, true, 'NWSL'],
      ['womens-world-cup-squares', Sport.SOCCER, SelectionType.SQUARES, true, 'FIFA Women\'s World Cup'],
      ['world-cup-squares', Sport.SOCCER, SelectionType.SQUARES, true, 'FIFA World Cup'],
    ]);
    for (const template of templates) {
      expect(ContestRulesWithEntryLimitSchema.parse(template.configJson))
        .toEqual({ selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 10, maxEntriesPerSquad: 1 });
    }
  });

  it('plays men\'s college basketball in two halves and leaves every other seeded sport league on its sport\'s periods (#786)', async () => {
    const leagues = await getPrisma().sportLeague.findMany({ where: { matchPeriodLayout: { not: null } }, select: { name: true, matchPeriodLayout: true } });
    expect(leagues).toEqual([{ name: 'NCAA Men\'s Basketball', matchPeriodLayout: 'HALVES' }]);
  });

  it('calls the NCAA Division I tennis championships leagues and leaves every other seeded sport league on its sport\'s noun (#834)', async () => {
    const leagues = await getPrisma().sportLeague.findMany({
      where: { noun: { not: null } },
      select: { name: true, noun: true, sport: { select: { sport: true } } },
      orderBy: { name: 'asc' },
    });
    expect(leagues).toEqual([
      { name: 'NCAA Men\'s Tennis', noun: 'LEAGUE', sport: { sport: 'TENNIS' } },
      { name: 'NCAA Women\'s Tennis', noun: 'LEAGUE', sport: { sport: 'TENNIS' } },
    ]);
  });

  it('gives every seeded sport league its own place among its sport\'s leagues, the major professional leagues before the NCAA\'s', async () => {
    const leagues = await getPrisma().sportLeague.findMany({
      select: { name: true, displayOrder: true, sport: { select: { sport: true } } },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    expect(leagues.filter((league) => league.displayOrder === null).map((league) => league.name)).toEqual([]);
    const namesBySport = new Map<string, string[]>();
    for (const league of leagues) {
      namesBySport.set(league.sport.sport, [...(namesBySport.get(league.sport.sport) ?? []), league.name]);
    }
    for (const sport of namesBySport.keys()) {
      const orders = leagues.filter((league) => league.sport.sport === sport).map((league) => league.displayOrder);
      expect(new Set(orders).size).toBe(orders.length);
    }
    expect(namesBySport.get(Sport.FOOTBALL)).toEqual(['NFL', 'NCAA Men\'s Football']);
    expect(namesBySport.get(Sport.BASKETBALL)).toEqual(['NBA', 'WNBA', 'NCAA Men\'s Basketball', 'NCAA Women\'s Basketball']);
    expect(namesBySport.get(Sport.BASEBALL)).toEqual(['MLB']);
    expect(namesBySport.get(Sport.GOLF)).toEqual(['PGA TOUR', 'LPGA Tour']);
    // #1716: horse racing's one league is reference data, as every other sport's leagues are.
    expect(namesBySport.get(Sport.HORSE_RACING)).toEqual(['US Thoroughbred']);
    expect(namesBySport.get(Sport.HOCKEY)).toEqual(['NHL', 'PWHL', 'NCAA Men\'s Hockey', 'NCAA Women\'s Hockey']);
    expect(namesBySport.get(Sport.SOCCER)?.slice(-2)).toEqual(['NCAA Men\'s Soccer', 'NCAA Women\'s Soccer']);
  });

  it('gives every seeded active event page with offers exactly one primary offer, whose edition dates the page', async () => {
    const pages = await getPrisma().eventPage.findMany({ where: { isActive: true }, select: { urlSegment: true, offers: { select: { isPrimary: true } } } });

    expect(pages.filter((page) => page.offers.length > 0 && page.offers.filter((offer) => offer.isPrimary).length !== 1).map((page) => page.urlSegment)).toEqual([]);
  });
});

// What contest creation holds a template's rules to, checked on every seeded template of every
// sport rather than sport by sport, so a preset seeded for a new sport or series that no
// commissioner could create a contest from fails here instead of on the create page.
describe('Every seeded contest template, whatever its sport', () => {
  async function activeTemplates() {
    return getPrisma().contestConfigTemplate.findMany({
      where: { active: true },
      include: { sportLeague: { include: { platformTierProfile: { include: { _count: { select: { ranges: true } } } }, sport: true } } },
      orderBy: [{ sportLeague: { sport: { sport: 'asc' } } }, { templateKey: 'asc' }],
    });
  }

  it('parses as its own selection type\'s rules, one the sport offers, scored by a definition the sport offers or one that needs no settings', async () => {
    const templates = await activeTemplates();

    expect(new Set(templates.map((template) => template.sportLeague.sport.sport))).toEqual(new Set(SCORED_SPORTS));
    const problems = templates.flatMap((template) => {
      const definition = sportLeagueDefinitionOf(template.sportLeague.sport.sport, template.sportLeague);
      const parsed = ContestRulesWithEntryLimitSchema.safeParse(template.configJson);
      if (!parsed.success) {
        return [`${template.templateKey}: rules do not parse`];
      }
      const rules = parsed.data;
      const found: string[] = [];
      if (rules.selectionType !== template.selectionType) {
        found.push(`${template.templateKey}: ${rules.selectionType} rules on a ${template.selectionType} template`);
      }
      if (!sportAllowsSelectionType(definition, rules.selectionType)) {
        found.push(`${template.templateKey}: ${template.sportLeague.sport.sport} offers no ${rules.selectionType} selection`);
      }
      if (rules.scoring && !definition.scoringDefinitions.includes(rules.scoring.participantScoringDefinitionId)) {
        found.push(`${template.templateKey}: ${template.sportLeague.sport.sport} offers no ${rules.scoring.participantScoringDefinitionId} scoring`);
      }
      // With no preset, the sport's first definition is used with its default settings, which
      // only a definition that takes none has.
      const [defaultDefinitionId] = definition.scoringDefinitions;
      // A squares contest scores by the quarters its boxes win, and pick'em and survivor by their
      // own picks, not by a participant scoring definition.
      const scoresByOwnRules = rules.selectionType === SelectionType.SQUARES
        || rules.selectionType === SelectionType.PICK_EM
        || rules.selectionType === SelectionType.SURVIVOR;
      if (!scoresByOwnRules && !rules.scoring && !PARTICIPANT_SCORING_SETTINGS_SCHEMAS[defaultDefinitionId].safeParse({}).success) {
        found.push(`${template.templateKey}: no scoring preset, and ${defaultDefinitionId} needs settings`);
      }
      return found;
    });

    expect(problems).toEqual([]);
  });

  it('counts no more scores than an entry holds: a tiered preset on its league\'s tier profile\'s tiers, a budget roster, or a draw\'s hand', async () => {
    const templates = await activeTemplates();

    const problems = templates.flatMap((template) => {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      const held = (() => {
        switch (rules.selectionType) {
          case SelectionType.TIERED:
            return getTieredRosterSize(
              // A RANGES profile has one tier per range and no tier count (#2160).
              getTiersInPlay(template.sportLeague.platformTierProfile.tierCount ?? template.sportLeague.platformTierProfile._count.ranges, rules.tiersUsed),
              rules.picksPerTier,
            );
          case SelectionType.BUDGET_PICK:
            return rules.rosterSize;
          case SelectionType.RANDOM_DRAW:
            return rules.picksPerEntry;
          case SelectionType.PICK_EM:
          case SelectionType.BRACKET:
          case SelectionType.SURVIVOR:
          case SelectionType.SQUARES:
            // A prediction or squares preset holds no lineup and counts no scores: nothing to compare.
            return null;
          default:
            return assertNever(rules, 'selection type');
        }
      })();
      if (
        held === null
        || rules.selectionType === SelectionType.PICK_EM
        || rules.selectionType === SelectionType.BRACKET
        || rules.selectionType === SelectionType.SURVIVOR
        || rules.selectionType === SelectionType.SQUARES
      ) return [];
      return rules.countedScores > held ? [`${template.templateKey}: counts ${rules.countedScores} of ${held}`] : [];
    });

    expect(problems).toEqual([]);
  });

  it('gives every tiered template a budget twin in its league, the same roster size, counted scores and scoring, but the shrink-only list of those not yet twinned', async () => {
    const templates = await activeTemplates();
    const rulesOf = (template: (typeof templates)[number]) => ContestRulesWithEntryLimitSchema.parse(template.configJson);

    const untwinned = templates.flatMap((template) => {
      const rules = rulesOf(template);
      if (rules.selectionType !== SelectionType.TIERED) return [];
      const profile = template.sportLeague.platformTierProfile;
      const held = getTieredRosterSize(getTiersInPlay(profile.tierCount ?? profile._count.ranges, rules.tiersUsed), rules.picksPerTier);
      const twinned = templates.some((other) => {
        if (other.sportLeagueId !== template.sportLeagueId) return false;
        const budget = rulesOf(other);
        return budget.selectionType === SelectionType.BUDGET_PICK
          && budget.rosterSize === held
          && budget.countedScores === rules.countedScores
          && JSON.stringify(budget.scoring) === JSON.stringify(rules.scoring);
      });
      return twinned ? [] : [`${template.sportLeague.urlSegment}/${template.templateKey}`];
    }).sort();

    // The list only shrinks: a new tiered template comes with its budget twin, and one twinned
    // later leaves the list in the same change.
    expect(untwinned).toEqual(TIERED_TEMPLATES_WITHOUT_BUDGET_TWIN);
  });

  it('starts every sport league\'s tier and pricing profiles with the same source, so tiers and prices agree on who is best (#2160)', async () => {
    const leagues = await getPrisma().sportLeague.findMany({
      select: {
        name: true,
        platformTierProfile: { select: { code: true, sources: { orderBy: { orderIndex: 'asc' }, take: 1, select: { basis: true } } } },
        platformPricingProfile: { select: { code: true, sources: { orderBy: { orderIndex: 'asc' }, take: 1, select: { basis: true } } } },
      },
    });

    const disagreeing = leagues.flatMap(({ name, platformTierProfile: tiers, platformPricingProfile: prices }) => {
      const tierFirst = tiers.sources.at(0)?.basis;
      const priceFirst = prices.sources.at(0)?.basis;
      return tierFirst !== undefined && tierFirst === priceFirst ? [] : [`${name}: ${tiers.code} starts with ${tierFirst ?? 'nothing'}, ${prices.code} with ${priceFirst ?? 'nothing'}`];
    });

    expect(leagues.length).toBeGreaterThan(30);
    expect(disagreeing).toEqual([]);
  });

  // Roster presets only: a pick'em contest (#716) is set up without a template, so its selection
  // type, a PREDICTION one, has no ROSTER preset to find. A league played only in weeks (the
  // Premier League, #787) hosts no roster contest, as roster formats are played on a knockout.
  it('gives each seeded sport league a roster default and a preset for every roster selection type its sport offers', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { active: true, contestFormat: ContestFormat.ROSTER },
    });
    const leagues = await getPrisma().sportLeague.findMany({ include: { sport: true }, orderBy: { name: 'asc' } });

    // What the create page offers for an event: its league's own presets.
    const scopes = leagues.filter((league) => SCORED_SPORTS.includes(league.sport.sport) && !LEAGUES_PLAYED_ONLY_IN_WEEKS.includes(league.name)).map((league) => ({
      name: league.name,
      sport: league.sport.sport,
      definition: sportLeagueDefinitionOf(league.sport.sport, league),
      offered: templates.filter((template) => template.sportLeagueId === league.id),
    }));

    const problems = scopes.flatMap(({ name, definition, offered }) => [
      ...(offered.some((template) => template.isDefault) ? [] : [`${name}: no default preset`]),
      ...definition.selectionTypes
        .filter((selectionType) => isRosterSelectionType(selectionType))
        .filter((selectionType) => !offered.some((template) => template.selectionType === selectionType))
        .map((selectionType) => `${name}: no ${selectionType} preset`),
    ]);

    expect(scopes.map(({ name }) => name)).toEqual(expect.arrayContaining(['IndyCar', "UCI Women's WorldTour", 'World Marathon Majors (women)']));
    expect(problems).toEqual([]);
  });
});

/**
 * A seeded league of the sport, read back through the sport league repository: the migration names
 * it, so the test finds its row by that name, then reads it as the app does, by id.
 */
function seededLeagueReader(sportId: string) {
  const sportLeagues = new PrismaSportLeagueRepository(getAppPrisma());
  return async (name: string) => {
    const { id } = await getPrisma().sportLeague.findUniqueOrThrow({ where: { sportId_name: { sportId, name } }, select: { id: true } });
    return sportLeagues.findById(id);
  };
}

// The NBA and WNBA playoffs (#706): two more basketball sport leagues, data only, each with its own
// round names and knockout presets sized to its bracket.
describe('The seeded NBA and WNBA leagues and their knockout templates', () => {
  it('seeds the NBA and WNBA as fixed brackets that name their own rounds, read back through the sport league repository', async () => {
    const basketball = await getPrisma().sport.findUniqueOrThrow({ where: { sport: Sport.BASKETBALL } });
    const seeded = seededLeagueReader(basketball.id);

    const [nba, wnba] = await Promise.all([seeded('NBA'), seeded('WNBA')]);

    expect([nba?.bracketAdvancement, nba?.roundNames]).toEqual(['FIXED', ['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals']]);
    expect([wnba?.bracketAdvancement, wnba?.roundNames]).toEqual(['FIXED', ['First Round', 'Semifinals', 'WNBA Finals']]);
    // The NCAA tournaments keep the sport's March Madness names.
    expect((await seeded('NCAA Men\'s Basketball'))?.roundNames).toEqual([]);
  });

  it.each([
    { league: 'NBA', prefix: 'nba', roundValues: [1, 2, 4, 8], rosterSize: 4 },
    { league: 'WNBA', prefix: 'wnba', roundValues: [1, 2, 4], rosterSize: 3 },
  ])('gives the $league a Doubling and a Doubling + upset bonus template per roster selection type, on one round value per round, the plain Doubling one each format\'s default', async ({ league, prefix, roundValues, rosterSize }) => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.BASKETBALL }, name: league }, contestFormat: ContestFormat.ROSTER },
      orderBy: [{ templateKey: 'asc' }],
    });

    expect(templates.map((template) => [template.templateKey, template.selectionType, template.isDefault])).toEqual([
      [`${prefix}-budget-doubling`, SelectionType.BUDGET_PICK, true],
      [`${prefix}-budget-doubling-upset-bonus`, SelectionType.BUDGET_PICK, false],
      [`${prefix}-random-draw-doubling`, SelectionType.RANDOM_DRAW, true],
      [`${prefix}-random-draw-doubling-upset-bonus`, SelectionType.RANDOM_DRAW, false],
      [`${prefix}-tiered-doubling`, SelectionType.TIERED, true],
      [`${prefix}-tiered-doubling-upset-bonus`, SelectionType.TIERED, false],
    ]);
    for (const template of templates) {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      expect(rules.scoring).toEqual({
        participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
        config: {
          roundValues,
          upsetBonus: template.templateKey.endsWith('-upset-bonus') ? { rule: 'SEED_DIFFERENCE', multiplier: 1 } : { rule: 'NONE' },
        },
      });
      if (rules.selectionType === SelectionType.BUDGET_PICK) expect(rules.rosterSize).toBe(rosterSize);
    }
  });
});

// NCAA men's football (#707, renamed in #2143): a football sport league, data only, whose College
// Football Playoff has its own round names, its own six tiers and knockout presets for its four rounds.
describe('The seeded NCAA Men\'s Football league and its knockout templates', () => {
  it('seeds NCAA Men\'s Football as a fixed bracket that names its own rounds and starts its events on six tiers, read back through the sport league repository', async () => {
    const football = await getPrisma().sport.findUniqueOrThrow({ where: { sport: Sport.FOOTBALL } });
    const seeded = seededLeagueReader(football.id);

    const [cfp, nfl] = await Promise.all([seeded('NCAA Men\'s Football'), seeded('NFL')]);

    const platformTierProfileCodes = new Map((await getPrisma().platformTierProfile.findMany()).map((profile) => [profile.id, profile.code]));
    expect([cfp?.bracketAdvancement, cfp?.roundNames, platformTierProfileCodes.get(cfp?.platformTierProfileId ?? '')]).toEqual(['FIXED', ['First Round', 'Quarterfinals', 'Semifinals', 'National Championship'], 'TIERS_6_OF_2']);
    // The NFL keeps the sport's round names and football's seven tiers of two.
    expect([nfl?.roundNames, platformTierProfileCodes.get(nfl?.platformTierProfileId ?? '')]).toEqual([[], 'PLAYOFF_SEEDS_1_4_REST']);
  });

  it('gives the College Football Playoff a Doubling and a Doubling + upset bonus template per roster selection type on round values 1, 2, 4, 8, the plain Doubling one each format\'s default, picking one team from each of six tiers', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.FOOTBALL }, name: 'NCAA Men\'s Football' }, contestFormat: ContestFormat.ROSTER },
      orderBy: [{ templateKey: 'asc' }],
    });

    expect(templates.map((template) => [template.templateKey, template.selectionType, template.isDefault])).toEqual([
      ['cfp-budget-doubling', SelectionType.BUDGET_PICK, true],
      ['cfp-budget-doubling-upset-bonus', SelectionType.BUDGET_PICK, false],
      ['cfp-random-draw-doubling', SelectionType.RANDOM_DRAW, true],
      ['cfp-random-draw-doubling-upset-bonus', SelectionType.RANDOM_DRAW, false],
      ['cfp-tiered-doubling', SelectionType.TIERED, true],
      ['cfp-tiered-doubling-upset-bonus', SelectionType.TIERED, false],
    ]);
    for (const template of templates) {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      expect(rules.scoring).toEqual({
        participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
        config: {
          roundValues: [1, 2, 4, 8],
          upsetBonus: template.templateKey.endsWith('-upset-bonus') ? { rule: 'SEED_DIFFERENCE', multiplier: 1 } : { rule: 'NONE' },
        },
      });
      if (rules.selectionType === SelectionType.TIERED) expect(rules.countedScores).toBe(6);
    }
  });
});

// Create contest starts every format on a template (#802): a sport league offers exactly one
// default for each format it can host, on each kind of event it plays, so a commissioner never
// starts from blank rules. A sport played as matches holds two kinds of event: a knockout (the
// playoffs, a tournament bracket), and a week of a season's games, which only the leagues below
// play. Squares is played on any one game, a week's or the playoffs', so its template names no kind
// of event. Every other sport's events are all one kind, so its templates name none.
const KNOCKOUT_SELECTION_TYPES: readonly SelectionType[] = [
  SelectionType.TIERED,
  SelectionType.BUDGET_PICK,
  SelectionType.RANDOM_DRAW,
  SelectionType.BRACKET,
  SelectionType.SURVIVOR,
  SelectionType.SQUARES,
];
/** The formats each league played in weeks hosts on a week: soccer's group matchdays offer pick'em only (#787). */
const WEEK_SELECTION_TYPES: Readonly<Record<string, readonly SelectionType[]>> = {
  NFL: [SelectionType.PICK_EM, SelectionType.SURVIVOR, SelectionType.SQUARES],
  'Premier League': [SelectionType.PICK_EM, SelectionType.SURVIVOR],
  'FIFA World Cup': [SelectionType.PICK_EM],
  'FIFA Women\'s World Cup': [SelectionType.PICK_EM],
  'UEFA European Championship': [SelectionType.PICK_EM],
  'Copa América': [SelectionType.PICK_EM],
  'UEFA Champions League': [SelectionType.PICK_EM],
};
/** Leagues with no knockout events: a season of weeks and nothing else. */
const LEAGUES_PLAYED_ONLY_IN_WEEKS: readonly string[] = ['Premier League'];
// A playoff series is one match whose score is games won (NBA, WNBA, NHL, PWHL, MLB), so squares,
// played on one game's score, has no template there.
const LEAGUES_PLAYED_AS_SERIES: readonly string[] = ['NBA', 'WNBA', 'NHL', 'PWHL', 'MLB'];

/** What Create contest calls each format, which every template's name starts with. */
const FORMAT_NAMES: Record<SelectionType, string> = {
  TIERED: 'Tiered',
  BUDGET_PICK: 'Budget',
  RANDOM_DRAW: 'Quick pick',
  PICK_EM: 'Pick’em',
  BRACKET: 'Bracket',
  SURVIVOR: 'Survivor',
  SQUARES: 'Squares',
};

describe('Every seeded sport league\'s default templates and their names (#802)', () => {
  it('offers each sport league exactly one default for every format it hosts, whatever kind of event it is played on (#2010)', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({ where: { active: true } });
    const leagues = await getPrisma().sportLeague.findMany({ include: { sport: true }, orderBy: { name: 'asc' } });
    const scopes = leagues.filter((league) => SCORED_SPORTS.includes(league.sport.sport))
      .map((league) => ({ name: league.name, sport: league.sport.sport, sportLeagueId: league.id, definition: sportLeagueDefinitionOf(league.sport.sport, league) }));

    const problems = scopes.flatMap(({ name, sportLeagueId, definition }) => {
      const hosted: readonly SelectionType[] = definitionPlaysMatches(definition)
        ? [...new Set([
          ...(LEAGUES_PLAYED_ONLY_IN_WEEKS.includes(name) ? [] : KNOCKOUT_SELECTION_TYPES),
          ...(WEEK_SELECTION_TYPES[name] ?? []),
        ])]
        : definition.selectionTypes;
      return hosted
        .filter((selectionType) => sportAllowsSelectionType(definition, selectionType))
        .filter((selectionType) => !(selectionType === SelectionType.SQUARES && LEAGUES_PLAYED_AS_SERIES.includes(name)))
        .flatMap((selectionType) => {
          // What Create contest starts on: the league's one default of the way of picking.
          const defaults = templates.filter((template) => template.selectionType === selectionType
            && template.isDefault
            && template.sportLeagueId === sportLeagueId);
          return defaults.length === 1 ? [] : [`${name} ${selectionType}: ${defaults.length} defaults`];
        });
    });

    expect(scopes.map(({ name }) => name)).toEqual(expect.arrayContaining(['NFL', 'NBA', 'Formula 1']));
    expect(problems).toEqual([]);
  });

  it('names every template "<Format>: <how you pick>, <how it scores>" in its own format\'s words, under 60 characters with no full stop', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({ where: { active: true }, orderBy: { templateKey: 'asc' } });

    const problems = templates.flatMap((template) => {
      const format = FORMAT_NAMES[template.selectionType];
      const found: string[] = [];
      if (!new RegExp(`^${format}( (majors|Slams) pool)?: \\S`).test(template.name)) found.push(`${template.templateKey}: "${template.name}" does not start "${format}: "`);
      if (template.name.length >= 60) found.push(`${template.templateKey}: name is ${template.name.length} characters`);
      if (template.name.endsWith('.')) found.push(`${template.templateKey}: name ends with a full stop`);
      return found;
    });

    expect(problems).toEqual([]);
  });

  it('describes every template in one or two plain sentences of at most 220 characters, with no setup jargon', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({ where: { active: true }, orderBy: { templateKey: 'asc' } });

    const problems = templates.flatMap((template) => {
      const { description, templateKey } = template;
      // A sentence ends at a full stop after a lowercase letter or a digit, so "U.S. Open" is not two.
      const sentences = description.split(/(?<=[a-z0-9][.!?])\s+/).filter((sentence) => sentence.length > 0);
      const found: string[] = [];
      if (description.length > 220) found.push(`${templateKey}: description is ${description.length} characters`);
      if (sentences.length > 2) found.push(`${templateKey}: description has ${sentences.length} sentences`);
      if (!description.endsWith('.')) found.push(`${templateKey}: description does not end with a full stop`);
      if (/\b(template|preset|config|entry total)\b/i.test(description)) found.push(`${templateKey}: description uses setup jargon`);
      return found;
    });

    expect(problems).toEqual([]);
  });
});

const SPORT_DATA_DIR = join(__dirname, '../../../packages/core-api/scripts/seed-golf');

// Every sport league can be tried by hand end to end (rules/architecture-rules.md §6 *Manual-testing
// seed data goes through the admin API*): the migrations seed it, so a test data file of its last
// season as played has to load it. Test cleanup keeps only the leagues a template names, so in
// practice this checks every league with a template, as the suite above does. A slate fills one
// event's field and does not count.
describe('Every seeded sport league\'s test data', () => {
  it('has a test data file of its last season as played for every sport league the migrations seed, so no league reaches QA with nothing to try', async () => {
    const covered = new Set(readdirSync(SPORT_DATA_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => parseSportDataFile(JSON.parse(readFileSync(join(SPORT_DATA_DIR, name), 'utf8')) as unknown))
      .filter((file) => !isTestSlate(file))
      .flatMap((file) => file.scope.sportLeagues.map((league) => `${file.scope.sport} ${league}`)));
    const leagues = await getPrisma().sportLeague.findMany({ include: { sport: true }, orderBy: { name: 'asc' } });

    expect(leagues.map((league) => `${league.sport.sport} ${league.name}`).filter((key) => !covered.has(key))).toEqual([]);
  });
});

/**
 * The matchday pick'em templates of the soccer cups, which cover no slots yet: the soccer cups
 * decision settles whether they get group-stage slots or go (#2153). Named here so the exception
 * is seen, and the check fails once one of them covers a slot or is deleted.
 */
const SOCCER_MATCHDAY_TEMPLATES_WITHOUT_SLOTS = [
  'copa-america-matchday-pick-em-confidence',
  'copa-america-matchday-pick-em-straight-up',
  'euro-matchday-pick-em-confidence',
  'euro-matchday-pick-em-straight-up',
  'womens-world-cup-matchday-pick-em-confidence',
  'womens-world-cup-matchday-pick-em-straight-up',
  'world-cup-matchday-pick-em-confidence',
  'world-cup-matchday-pick-em-straight-up',
];

describe('Seeded template coverage (#2010)', () => {
  const templates = () => new PrismaContestConfigTemplateRepository(getAppPrisma()).list({ active: true });
  /** Every seeded template, switched off or in a switched-off league too: each is held to the same checks (#2153). */
  const everyTemplate = () => new PrismaContestConfigTemplateRepository(getAppPrisma()).list();

  it('gives every seeded template, active or not and in an active or a switched-off league, slots its coverage mode and selection type allow: ALL_LISTED and FROM_SLOT within one competition, ALL_LISTED within one event, a bracket only on knockout slots', async () => {
    const leagues = new Map((await getPrisma().sportLeague.findMany({ select: { id: true, isActive: true } })).map((league) => [league.id, league.isActive]));
    const all = await everyTemplate();
    const problems = all.flatMap((template) => {
      const problem = templateCoverageProblem(template, template.slots);
      return problem === null ? [] : [`${template.templateKey}: ${problem}`];
    });

    // Switched-off leagues' templates are read too: the tennis tours are off.
    expect(all.some((template) => leagues.get(template.sportLeagueId) === false)).toBe(true);
    expect(problems).toEqual([]);
  });

  it('gives every seeded template, in an active or a switched-off league, at least one slot to cover, but for the soccer cups\' matchday pick\'em still waiting on their slots', async () => {
    const prisma = getPrisma();
    const leagues = new Map((await prisma.sportLeague.findMany({ select: { id: true, isActive: true } })).map((league) => [league.id, league.isActive]));
    const all = await everyTemplate();
    const withoutSlots = all.filter((template) => template.slots.length === 0).map((template) => template.templateKey).sort();

    expect(new Set(all.map((template) => leagues.get(template.sportLeagueId)))).toEqual(new Set([true, false]));
    expect(withoutSlots).toEqual(SOCCER_MATCHDAY_TEMPLATES_WITHOUT_SLOTS);
  });

  it('leaves the tennis knockout survivors on their regular season\'s tournaments, without the tour Finals of the postseason, so a survivor stays in one competition', async () => {
    const survivors = (await everyTemplate()).filter((template) => ['atp-knockout-survivor', 'wta-knockout-survivor'].includes(template.templateKey));

    expect(survivors.map((template) => template.templateKey).sort()).toEqual(['atp-knockout-survivor', 'wta-knockout-survivor']);
    expect(survivors.map((template) => [template.templateKey, [...new Set(template.slots.map((slot) => slot.competitionCode))]])).toEqual(
      survivors.map((template) => [template.templateKey, [LeaguePhase.REGULAR]]),
    );
  });

  it("maps the NFL's templates to its slots: pick'em one week, survivor from a week on, a bracket and the roster pools across the postseason, squares on any one game slot", async () => {
    const nfl = await getPrisma().sportLeague.findFirstOrThrow({ where: { name: 'NFL' } });
    const coverage = Object.fromEntries((await templates())
      .filter((template) => template.sportLeagueId === nfl.id)
      .map((template) => [template.templateKey, [template.coverageMode, [...new Set(template.slots.map((slot) => slot.phase))].sort()]]));

    expect(coverage).toMatchObject({
      'nfl-pick-em-straight-up': [TemplateCoverageMode.ONE_SLOT, [LeaguePhase.REGULAR]],
      'nfl-survivor': [TemplateCoverageMode.FROM_SLOT, [LeaguePhase.REGULAR]],
      'nfl-playoff-survivor': [TemplateCoverageMode.FROM_SLOT, [LeaguePhase.POSTSEASON]],
      'nfl-bracket-doubling': [TemplateCoverageMode.ALL_LISTED, [LeaguePhase.POSTSEASON]],
      'nfl-tiered-pick-3': [TemplateCoverageMode.ALL_LISTED, [LeaguePhase.POSTSEASON]],
      'nfl-budget-pick-3': [TemplateCoverageMode.ALL_LISTED, [LeaguePhase.POSTSEASON]],
      'nfl-squares': [TemplateCoverageMode.ONE_SLOT, [LeaguePhase.POSTSEASON, LeaguePhase.REGULAR]],
    });
  });

  it('keeps one tournament per golf and tennis contest: every PGA TOUR and ATP template covers its tournaments one at a time, survivor from one on', async () => {
    const leagues = await getPrisma().sportLeague.findMany({ where: { name: { in: ['PGA TOUR', 'ATP'] } }, select: { id: true } });
    const ours = (await templates()).filter((template) => leagues.some((league) => league.id === template.sportLeagueId));

    expect(ours.length).toBeGreaterThan(0);
    expect(ours.filter((template) => template.coverageMode !== (template.selectionType === SelectionType.SURVIVOR ? TemplateCoverageMode.FROM_SLOT : TemplateCoverageMode.ONE_SLOT)).map((template) => template.templateKey)).toEqual([]);
    expect(ours.filter((template) => !template.slots.every((slot) => slot.slotKind === SlotKind.TOURNAMENT)).map((template) => template.templateKey)).toEqual([]);
  });

  it('refuses a second default of one selection type in one sport league, so Create contest starts on one', async () => {
    const prisma = getPrisma();
    const seeded = await prisma.contestConfigTemplate.findFirstOrThrow({ where: { isDefault: true, active: true } });

    await expect(prisma.contestConfigTemplate.create({
      data: {
        sportLeagueId: seeded.sportLeagueId, coverageMode: seeded.coverageMode, contestFormat: seeded.contestFormat, selectionType: seeded.selectionType,
        templateKey: `second-default-${seeded.id}`, name: 'Second default', description: 'Refused', sortOrder: 99, isDefault: true, configJson: seeded.configJson ?? {},
      },
    })).rejects.toThrow();
  });

  it('refuses deleting a slot definition a template covers or a Season slot plays, so no contest or template loses its slot', async () => {
    const prisma = getPrisma();
    const covered = await prisma.contestConfigTemplateSlot.findFirstOrThrow({ select: { sportLeagueCompetitionSlotId: true } });
    const played = await prisma.sportLeagueSeasonCompetitionSlot.findFirstOrThrow({ select: { sportLeagueCompetitionSlotId: true } });

    await expect(prisma.sportLeagueCompetitionSlot.delete({ where: { id: covered.sportLeagueCompetitionSlotId } })).rejects.toThrow();
    await expect(prisma.sportLeagueCompetitionSlot.delete({ where: { id: played.sportLeagueCompetitionSlotId } })).rejects.toThrow();
  });
});
