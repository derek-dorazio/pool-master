import {
  ContestFormat,
  ContestRulesWithEntryLimitSchema,
  ContestTemplateEventType,
  PARTICIPANT_SCORING_SETTINGS_SCHEMAS,
  SUPPORTED_SPORTS,
  SelectionType,
  Sport,
  assertNever,
  getSportDefinition,
  getTieredRosterSize,
  isRosterSelectionType,
  sportAllowsSelectionType,
  sportPlaysMatches,
} from '@poolmaster/shared/domain';
import {
  cleanupTestData,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { PrismaSportLeagueRepository } from '../../../packages/core-api/src/adapters';

// The contest templates the migrations seed, read back from real Postgres. A template with a
// sport league is offered only for that league's events, so a template pointing at a league of
// another sport would be offered nowhere it can be used: checked for every sport, so a mis-seeded
// row of any future sport fails here. Auto racing's series and their points presets (#624, and
// Formula 1 in #625) are checked value by value, and every sport's presets, golf and horse racing
// included, against the rules contest creation holds them to. No mocks.

// Only a sport with a scoring definition can host a contest, so only it is owed presets.
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

  it('seeds auto racing\'s three series, each with a budget, a tiered and a random-draw template of its own, every one the default of its format', async () => {
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
    expect(new Set(templates.map((template) => template.sportLeague?.sport.sport))).toEqual(new Set([Sport.AUTO_RACING]));
  });

  it('sorts the Formula 1 budget default first among the Formula 1 templates', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sport: Sport.AUTO_RACING, sportLeague: { name: 'Formula 1' } },
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
      where: { sport: Sport.AUTO_RACING },
      include: { sportLeague: true },
    });

    expect(NASCAR_CUP_POINTS).toHaveLength(40);
    expect(INDYCAR_POINTS).toHaveLength(33);
    expect(FORMULA_1_POINTS).toHaveLength(10);
    expect(new Set(templates.map((template) => template.sportLeague?.name)))
      .toEqual(new Set(Object.keys(POINTS_BY_SERIES)));
    for (const template of templates) {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      expect(rules.selectionType).toBe(template.selectionType);
      expect(rules.maxEntriesPerSquad).toBe(1);
      expect(rules.scoring).toEqual({
        participantScoringDefinitionId: 'FINISH_POSITION_POINTS',
        config: {
          pointsTable: POINTS_BY_SERIES[template.sportLeague?.name ?? ''],
          didNotFinishPoints: 0,
        },
      });
    }
  });

  it('counts five drivers in the budget presets, five in the NASCAR and IndyCar tiered presets, four in the Formula 1 tiered preset and one in the random draw', async () => {
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

// The PGA TOUR's majors pool (#714): golf's default tiered rules, covering the four majors by the
// names their series take.
describe('Seeded PGA TOUR majors pool template', () => {
  it('seeds an active majors template on the PGA TOUR and on the LPGA Tour, neither a default, naming each tour\'s majors\' series, with golf\'s one-a-tier, best-four rules', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { eventSeriesNames: { isEmpty: false } },
      include: { sportLeague: true },
      orderBy: { templateKey: 'asc' },
    });

    expect(templates.map((template) => [
      template.sportLeague?.name,
      template.templateKey,
      template.isDefault,
      template.active,
      template.eventSeriesNames,
    ])).toEqual([
      [
        'LPGA Tour',
        'lpga-tour-majors-tiered',
        false,
        true,
        ['The Chevron Championship', "U.S. Women's Open", "KPMG Women's PGA Championship", 'The Amundi Evian Championship', "AIG Women's Open"],
      ],
      [
        'PGA TOUR',
        'pga-tour-majors-tiered',
        false,
        true,
        ['Masters Tournament', 'PGA Championship', 'U.S. Open', 'The Open Championship'],
      ],
    ]);
    for (const template of templates) {
      expect(ContestRulesWithEntryLimitSchema.parse(template.configJson)).toEqual({
        selectionType: SelectionType.TIERED,
        picksPerTier: 1,
        countedScores: 4,
        maxEntriesPerSquad: 1,
      });
    }
  });
});

// Cycling's tours and their Top 10 presets (#626), checked value by value.
const CYCLING_TOP_10_POINTS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

describe('Seeded cycling tours and their Top 10 templates', () => {
  it('seeds cycling\'s two tours, each with a tiered, a budget and a random-draw template of its own, every one the default of its format', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sport: Sport.CYCLING },
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
      ["UCI Women's WorldTour", 'uci-womens-worldtour-budget-top-10', SelectionType.BUDGET_PICK, true, true],
      ["UCI Women's WorldTour", 'uci-womens-worldtour-random-draw-top-10', SelectionType.RANDOM_DRAW, true, true],
      ["UCI Women's WorldTour", 'uci-womens-worldtour-tiered-top-10', SelectionType.TIERED, true, true],
      ['UCI WorldTour', 'uci-worldtour-budget-top-10', SelectionType.BUDGET_PICK, true, true],
      ['UCI WorldTour', 'uci-worldtour-random-draw-top-10', SelectionType.RANDOM_DRAW, true, true],
      ['UCI WorldTour', 'uci-worldtour-tiered-top-10', SelectionType.TIERED, true, true],
    ]);
    expect(new Set(templates.map((template) => template.sportLeague?.sport.sport))).toEqual(new Set([Sport.CYCLING]));
  });

  it('presets Top 10 points (10 down to 1, 0 for an abandon) on every cycling template, each a valid template configuration', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({ where: { sport: Sport.CYCLING } });

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
      where: { sport: Sport.CYCLING },
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
      where: { sport: Sport.RUNNING },
      include: { sportLeague: { include: { sport: true } } },
      orderBy: [{ templateKey: 'asc' }],
    });

    expect(templates.map((template) => [
      template.sportLeague?.name,
      template.templateKey,
      template.selectionType,
      template.isDefault,
      template.active,
      template.name,
    ])).toEqual([
      ['World Marathon Majors (men)', 'wmm-men-budget-top-10', SelectionType.BUDGET_PICK, true, true, 'Budget: 4 runners under the cap, Top 10 points'],
      ['World Marathon Majors (men)', 'wmm-men-random-draw-top-10', SelectionType.RANDOM_DRAW, true, true, 'Random draw: 1 runner each, Top 10 points'],
      ['World Marathon Majors (men)', 'wmm-men-tiered-top-10', SelectionType.TIERED, true, true, 'Tiered: 1 runner per tier, Top 10 points'],
      ['World Marathon Majors (women)', 'wmm-women-budget-top-10', SelectionType.BUDGET_PICK, true, true, 'Budget: 4 runners under the cap, Top 10 points'],
      ['World Marathon Majors (women)', 'wmm-women-random-draw-top-10', SelectionType.RANDOM_DRAW, true, true, 'Random draw: 1 runner each, Top 10 points'],
      ['World Marathon Majors (women)', 'wmm-women-tiered-top-10', SelectionType.TIERED, true, true, 'Tiered: 1 runner per tier, Top 10 points'],
    ]);
    expect(new Set(templates.map((template) => template.sportLeague?.sport.sport))).toEqual(new Set([Sport.RUNNING]));
  });

  it('presets Top 10 points (10 down to 1, 0 for a runner who drops out) on every running template, each a valid template configuration', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({ where: { sport: Sport.RUNNING } });

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
      where: { sport: Sport.RUNNING },
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
      where: { sport: Sport.BASKETBALL, templateKey: { startsWith: 'ncaa-' }, contestFormat: ContestFormat.ROSTER },
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
      ['NCAA Division I Men', 'ncaa-men-budget-doubling', SelectionType.BUDGET_PICK, true, true],
      ['NCAA Division I Men', 'ncaa-men-budget-doubling-upset-bonus', SelectionType.BUDGET_PICK, false, true],
      ['NCAA Division I Men', 'ncaa-men-random-draw-doubling', SelectionType.RANDOM_DRAW, true, true],
      ['NCAA Division I Men', 'ncaa-men-random-draw-doubling-upset-bonus', SelectionType.RANDOM_DRAW, false, true],
      ['NCAA Division I Men', 'ncaa-men-tiered-doubling', SelectionType.TIERED, true, true],
      ['NCAA Division I Men', 'ncaa-men-tiered-doubling-upset-bonus', SelectionType.TIERED, false, true],
      ['NCAA Division I Women', 'ncaa-women-budget-doubling', SelectionType.BUDGET_PICK, true, true],
      ['NCAA Division I Women', 'ncaa-women-budget-doubling-upset-bonus', SelectionType.BUDGET_PICK, false, true],
      ['NCAA Division I Women', 'ncaa-women-random-draw-doubling', SelectionType.RANDOM_DRAW, true, true],
      ['NCAA Division I Women', 'ncaa-women-random-draw-doubling-upset-bonus', SelectionType.RANDOM_DRAW, false, true],
      ['NCAA Division I Women', 'ncaa-women-tiered-doubling', SelectionType.TIERED, true, true],
      ['NCAA Division I Women', 'ncaa-women-tiered-doubling-upset-bonus', SelectionType.TIERED, false, true],
    ]);
    expect(new Set(templates.map((template) => template.sportLeague?.sport.sport))).toEqual(new Set([Sport.BASKETBALL]));
  });

  it('presets round values 1, 2, 4, 8, 16 and 32 on every roster and bracket template, with no upset bonus on Doubling and the seed difference times 1 on Doubling + upset bonus', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sport: Sport.BASKETBALL, templateKey: { startsWith: 'ncaa-' }, selectionType: { not: SelectionType.SURVIVOR } },
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

// The NFL's knockout presets (#702): four playoff rounds, so the doubling stops at 8.
describe('The seeded NFL league and its knockout templates', () => {
  it('seeds the NFL, which reseeds, with a Doubling and a Doubling + upset bonus template per roster selection type on round values 1, 2, 4, 8, the plain Doubling one each format\'s default', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sport: Sport.AMERICAN_FOOTBALL, templateKey: { startsWith: 'nfl-' }, contestFormat: ContestFormat.ROSTER },
      include: { sportLeague: true },
      orderBy: [{ templateKey: 'asc' }],
    });

    expect(new Set(templates.map((template) => [template.sportLeague?.name, template.sportLeague?.bracketAdvancement].join(' ')))).toEqual(new Set(['NFL RESEED_BY_SEED']));
    expect(templates.map((template) => [template.templateKey, template.selectionType, template.isDefault])).toEqual([
      ['nfl-budget-doubling', SelectionType.BUDGET_PICK, true],
      ['nfl-budget-doubling-upset-bonus', SelectionType.BUDGET_PICK, false],
      ['nfl-random-draw-doubling', SelectionType.RANDOM_DRAW, true],
      ['nfl-random-draw-doubling-upset-bonus', SelectionType.RANDOM_DRAW, false],
      ['nfl-tiered-doubling', SelectionType.TIERED, true],
      ['nfl-tiered-doubling-upset-bonus', SelectionType.TIERED, false],
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

  // Squares (#711): the NFL's one squares preset, the default for its own format.
  it('seeds one squares template on the NFL and one on the College Football Playoff, ten boxes per entry and one entry per squad, each its league\'s squares default', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sport: Sport.AMERICAN_FOOTBALL, contestFormat: ContestFormat.SQUARES },
      include: { sportLeague: true },
      orderBy: { templateKey: 'asc' },
    });

    expect(templates.map((template) => [template.templateKey, template.selectionType, template.isDefault, template.sportLeague?.name]))
      .toEqual([
        ['cfp-squares', SelectionType.SQUARES, true, 'College Football Playoff'],
        ['nfl-squares', SelectionType.SQUARES, true, 'NFL'],
      ]);
    for (const template of templates) {
      expect(ContestRulesWithEntryLimitSchema.parse(template.configJson))
        .toEqual({ selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 10, maxEntriesPerSquad: 1 });
    }
  });
});

// What contest creation holds a template's rules to, checked on every seeded template of every
// sport rather than sport by sport, so a preset seeded for a new sport or series that no
// commissioner could create a contest from fails here instead of on the create page.
describe('Every seeded contest template, whatever its sport', () => {
  async function activeTemplates() {
    return getPrisma().contestConfigTemplate.findMany({
      where: { active: true },
      include: { sportLeague: true },
      orderBy: [{ sport: 'asc' }, { templateKey: 'asc' }],
    });
  }

  it('parses as its own selection type\'s rules, one the sport offers, scored by a definition the sport offers or one that needs no settings', async () => {
    const templates = await activeTemplates();

    expect(new Set(templates.map((template) => template.sport))).toEqual(new Set(SCORED_SPORTS));
    const problems = templates.flatMap((template) => {
      const definition = getSportDefinition(template.sport);
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
        found.push(`${template.templateKey}: ${template.sport} offers no ${rules.selectionType} selection`);
      }
      if (rules.scoring && !definition.scoringDefinitions.includes(rules.scoring.participantScoringDefinitionId)) {
        found.push(`${template.templateKey}: ${template.sport} offers no ${rules.scoring.participantScoringDefinitionId} scoring`);
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

  it('counts no more scores than an entry holds: a tiered preset on its league\'s or else its sport\'s default tiers, a budget roster, or a draw\'s hand', async () => {
    const templates = await activeTemplates();

    const problems = templates.flatMap((template) => {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      const held = (() => {
        switch (rules.selectionType) {
          case SelectionType.TIERED:
            return getTieredRosterSize(template.sportLeague?.tierCount ?? getSportDefinition(template.sport).defaultTierLayout.tierCount, rules.picksPerTier);
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

  // Roster presets only: a pick'em contest (#716) is set up without a template, so its selection
  // type, a PREDICTION one, has no ROSTER preset to find.
  it('gives each seeded sport league, and each sport with no league seeded, a roster default and a preset for every roster selection type its sport offers', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { active: true, contestFormat: ContestFormat.ROSTER },
    });
    const leagues = await getPrisma().sportLeague.findMany({ include: { sport: true }, orderBy: { name: 'asc' } });

    // What the create page offers for an event: its league's own presets with the sport-wide ones.
    const scopes = [
      ...leagues.filter((league) => SCORED_SPORTS.includes(league.sport.sport)).map((league) => ({
        name: league.name,
        sport: league.sport.sport,
        offered: templates.filter((template) => template.sport === league.sport.sport
          && (template.sportLeagueId === null || template.sportLeagueId === league.id)),
      })),
      ...SCORED_SPORTS
        .filter((sport) => !leagues.some((league) => league.sport.sport === sport))
        .map((sport) => ({
          name: `${sport} (sport-wide)`,
          sport,
          offered: templates.filter((template) => template.sport === sport && template.sportLeagueId === null),
        })),
    ];

    const problems = scopes.flatMap(({ name, sport, offered }) => [
      ...(offered.some((template) => template.isDefault) ? [] : [`${name}: no default preset`]),
      ...getSportDefinition(sport).selectionTypes
        .filter((selectionType) => isRosterSelectionType(selectionType))
        .filter((selectionType) => !offered.some((template) => template.selectionType === selectionType))
        .map((selectionType) => `${name}: no ${selectionType} preset`),
    ]);

    expect(scopes.map(({ name }) => name)).toEqual(expect.arrayContaining(['IndyCar', "UCI Women's WorldTour", 'World Marathon Majors (women)']));
    expect(problems).toEqual([]);
  });
});

// The NBA and WNBA playoffs (#706): two more basketball sport leagues, data only, each with its own
// round names and knockout presets sized to its bracket.
describe('The seeded NBA and WNBA leagues and their knockout templates', () => {
  it('seeds the NBA and WNBA as fixed brackets that name their own rounds, read back through the sport league repository', async () => {
    const basketball = await getPrisma().sport.findUniqueOrThrow({ where: { sport: Sport.BASKETBALL } });
    const sportLeagues = new PrismaSportLeagueRepository(getPrisma());

    const [nba, wnba] = await Promise.all([sportLeagues.findBySportAndName(basketball.id, 'NBA'), sportLeagues.findBySportAndName(basketball.id, 'WNBA')]);

    expect([nba?.bracketAdvancement, nba?.roundNames]).toEqual(['FIXED', ['First Round', 'Conference Semifinals', 'Conference Finals', 'NBA Finals']]);
    expect([wnba?.bracketAdvancement, wnba?.roundNames]).toEqual(['FIXED', ['First Round', 'Semifinals', 'WNBA Finals']]);
    // The NCAA tournaments keep the sport's March Madness names.
    expect((await sportLeagues.findBySportAndName(basketball.id, 'NCAA Division I Men'))?.roundNames).toEqual([]);
  });

  it.each([
    { league: 'NBA', prefix: 'nba', roundValues: [1, 2, 4, 8], rosterSize: 4 },
    { league: 'WNBA', prefix: 'wnba', roundValues: [1, 2, 4], rosterSize: 3 },
  ])('gives the $league a Doubling and a Doubling + upset bonus template per roster selection type, on one round value per round, the plain Doubling one each format\'s default', async ({ league, prefix, roundValues, rosterSize }) => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sport: Sport.BASKETBALL, sportLeague: { name: league }, contestFormat: ContestFormat.ROSTER },
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

// The College Football Playoff (#707): an American football sport league, data only, with its own
// round names, its own six tiers and knockout presets for its four rounds.
describe('The seeded College Football Playoff league and its knockout templates', () => {
  it('seeds the College Football Playoff as a fixed bracket that names its own rounds and starts its events on six tiers, read back through the sport league repository', async () => {
    const football = await getPrisma().sport.findUniqueOrThrow({ where: { sport: Sport.AMERICAN_FOOTBALL } });
    const sportLeagues = new PrismaSportLeagueRepository(getPrisma());

    const [cfp, nfl] = await Promise.all([
      sportLeagues.findBySportAndName(football.id, 'College Football Playoff'),
      sportLeagues.findBySportAndName(football.id, 'NFL'),
    ]);

    expect([cfp?.bracketAdvancement, cfp?.roundNames, cfp?.tierCount]).toEqual(['FIXED', ['First Round', 'Quarterfinals', 'Semifinals', 'National Championship'], 6]);
    // The NFL keeps the sport's round names and its seven tiers.
    expect([nfl?.roundNames, nfl?.tierCount]).toEqual([[], null]);
  });

  it('gives the College Football Playoff a Doubling and a Doubling + upset bonus template per roster selection type on round values 1, 2, 4, 8, the plain Doubling one each format\'s default, picking one team from each of six tiers', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sport: Sport.AMERICAN_FOOTBALL, sportLeague: { name: 'College Football Playoff' }, contestFormat: ContestFormat.ROSTER },
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
// play. Every other sport's events are all one kind, so its templates name none.
const KNOCKOUT_SELECTION_TYPES: readonly SelectionType[] = [
  SelectionType.TIERED,
  SelectionType.BUDGET_PICK,
  SelectionType.RANDOM_DRAW,
  SelectionType.BRACKET,
  SelectionType.SURVIVOR,
  SelectionType.SQUARES,
];
const WEEK_SELECTION_TYPES: readonly SelectionType[] = [SelectionType.PICK_EM, SelectionType.SURVIVOR];
const LEAGUES_PLAYED_IN_WEEKS: readonly string[] = ['NFL'];

/** What Create contest calls each format, which every template's name starts with. */
const FORMAT_NAMES: Record<SelectionType, string> = {
  TIERED: 'Tiered',
  BUDGET_PICK: 'Budget',
  RANDOM_DRAW: 'Random draw',
  PICK_EM: 'Pick’em',
  BRACKET: 'Bracket',
  SURVIVOR: 'Survivor',
  SQUARES: 'Squares',
};

describe('Every seeded sport league\'s default templates and their names (#802)', () => {
  it('offers each sport league, and each sport with no league seeded, exactly one default for every format it hosts on each kind of event it plays', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({ where: { active: true } });
    const leagues = await getPrisma().sportLeague.findMany({ include: { sport: true }, orderBy: { name: 'asc' } });
    const scopes = [
      ...leagues.filter((league) => SCORED_SPORTS.includes(league.sport.sport))
        .map((league) => ({ name: league.name, sport: league.sport.sport, sportLeagueId: league.id as string | null })),
      ...SCORED_SPORTS.filter((sport) => !leagues.some((league) => league.sport.sport === sport))
        .map((sport) => ({ name: `${sport} (sport-wide)`, sport, sportLeagueId: null as string | null })),
    ];

    const problems = scopes.flatMap(({ name, sport, sportLeagueId }) => {
      const definition = getSportDefinition(sport);
      const kinds: Array<{ eventType: ContestTemplateEventType | null; selectionTypes: readonly SelectionType[] }> = sportPlaysMatches(sport)
        ? [
          { eventType: ContestTemplateEventType.KNOCKOUT, selectionTypes: KNOCKOUT_SELECTION_TYPES },
          ...(LEAGUES_PLAYED_IN_WEEKS.includes(name) ? [{ eventType: ContestTemplateEventType.WEEK, selectionTypes: WEEK_SELECTION_TYPES }] : []),
        ]
        : [{ eventType: null, selectionTypes: definition.selectionTypes }];
      return kinds.flatMap(({ eventType, selectionTypes }) => selectionTypes
        .filter((selectionType) => sportAllowsSelectionType(definition, selectionType))
        .flatMap((selectionType) => {
          // What Create contest lists for an event of this kind: the league's own templates and the
          // sport-wide ones, for this kind of event or for any.
          const defaults = templates.filter((template) => template.sport === sport
            && template.selectionType === selectionType
            && template.isDefault
            && (template.sportLeagueId === null || template.sportLeagueId === sportLeagueId)
            && (template.eventType === null || template.eventType === eventType));
          return defaults.length === 1
            ? []
            : [`${name} ${eventType ?? 'any event'} ${selectionType}: ${defaults.length} defaults`];
        }));
    });

    expect(scopes.map(({ name }) => name)).toEqual(expect.arrayContaining(['NFL', 'NBA', 'Formula 1']));
    expect(problems).toEqual([]);
  });

  it('names every template "<Format>: <how you pick>, <how it scores>" in its own format\'s words, under 60 characters with no full stop', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({ where: { active: true }, orderBy: { templateKey: 'asc' } });

    const problems = templates.flatMap((template) => {
      const format = FORMAT_NAMES[template.selectionType];
      const found: string[] = [];
      if (!new RegExp(`^${format}( majors pool)?: \\S`).test(template.name)) found.push(`${template.templateKey}: "${template.name}" does not start "${format}: "`);
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
