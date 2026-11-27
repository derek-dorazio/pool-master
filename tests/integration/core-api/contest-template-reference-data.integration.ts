import {
  ContestFormat,
  ContestRulesWithEntryLimitSchema,
  LeaguePhase,
  MatchEnding,
  MatchSide,
  MatchStatus,
  SlotKind,
  TemplateCoverageMode,
  PARTICIPANT_SCORING_SETTINGS_SCHEMAS,
  SUPPORTED_SPORTS,
  SelectionType,
  Sport,
  assertNever,
  getSportDefinition,
  getTieredRosterSize,
  sportAllowsSelectionType,
  sportLeagueDefinitionOf,
  placeInRanges,
  templateCoverageProblem,
  type ContestRoundCoverage,
  type SportEventRoundMatch,
} from '@poolmaster/shared/domain';
import {
  cleanupTestData,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { enumLabel } from '@poolmaster/shared/display-strings';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaContestConfigTemplateRepository, PrismaSportLeagueRepository } from '../../../packages/core-api/src/adapters';
import { isTestSlate, parseSportDataFile } from '../../../packages/core-api/scripts/seed-golf/sport-data-file';
import type { SportEventParticipantView } from '../../../packages/core-api/src/modules/events/sport-event-participant-service';
import { scoreKnockoutField } from '../../../packages/core-api/src/modules/scoring-families/head-to-head/score-team';
import { expectDefined } from '../../support/expect-defined';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';
import { roundSlot } from '../../support/round-slots';
import { legacyMatch } from '../../support/match-sides';

/** A seeded league's knockout slot definitions, in play order: each one's name (null for its kind's word), kind and pairing (#2006). */
async function knockoutDefinitions(sportLeagueName: string): Promise<Array<[string | null, string, string]>> {
  const definitions = await getPrisma().sportLeagueCompetitionSlot.findMany({
    where: { sportLeague: { name: sportLeagueName }, slotKind: { notIn: ['WEEK', 'TOURNAMENT', 'THIRD_PLACE'] } },
    select: { name: true, slotKind: true, pairing: true },
    orderBy: { slotKind: 'asc' },
  });
  return definitions.map(({ name, slotKind, pairing }) => [name, slotKind, pairing]);
}

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

  it('counts five drivers in every series\' budget and tiered presets, so each tiered preset matches its budget twin, and one in the random draw', async () => {
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
      ['formula-1-tiered-points', 1, 5],
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
  it('gives PGA TOUR and LPGA Tour each their own copy of golf\'s six every-event setups, with the same keys and rules and three defaults each, so a change to one league\'s setup leaves the other\'s alone', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.GOLF } }, active: true },
      include: { sportLeague: true },
      orderBy: [{ sortOrder: 'asc' }],
    });
    const byLeague = (name: string) => templates.filter((template) => template.sportLeague.name === name);
    const shape = (template: (typeof templates)[number]) => [template.templateKey, template.isDefault, template.configJson];

    expect(byLeague('PGA TOUR').map((template) => template.templateKey)).toEqual([
      'golf-tiered-pick-6',
      'golf-tiered-pick-6-all-count',
      'golf-budget-pick-6-best-4',
      'golf-budget-pick-6-all-count',
      'golf-random-draw-1',
      'golf-random-draw-3-best-2',
    ]);
    expect(byLeague('LPGA Tour').map(shape)).toEqual(byLeague('PGA TOUR').map(shape));
    expect(byLeague('PGA TOUR').filter((template) => template.isDefault)).toHaveLength(3);
    expect(new Set(templates.map((template) => template.id)).size).toBe(12);
  });

  it('pairs each tour\'s tiered and budget setups, 6 golfers with all counting and with the best 4 counting, the best-4 pair the default, and no setup picking from only some tiers', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.GOLF } }, selectionType: { in: [SelectionType.TIERED, SelectionType.BUDGET_PICK] } },
      include: { sportLeague: true },
      orderBy: [{ sportLeague: { name: 'asc' } }, { sortOrder: 'asc' }],
    });

    const shapes = templates.map((template) => {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      if (rules.selectionType === SelectionType.TIERED) return [template.sportLeague.name, template.templateKey, template.isDefault, rules.picksPerTier, rules.countedScores];
      if (rules.selectionType === SelectionType.BUDGET_PICK) return [template.sportLeague.name, template.templateKey, template.isDefault, rules.rosterSize, rules.countedScores];
      throw new Error(`${template.templateKey} is not a roster template`);
    });
    const perTour = (name: string) => [
      [name, 'golf-tiered-pick-6', true, 1, 4],
      [name, 'golf-tiered-pick-6-all-count', false, 1, 6],
      [name, 'golf-budget-pick-6-best-4', true, 6, 4],
      [name, 'golf-budget-pick-6-all-count', false, 6, 6],
    ];
    expect(shapes).toEqual([...perTour('LPGA Tour'), ...perTour('PGA TOUR')]);
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
      ['World Marathon Majors (men)', 'wmm-men-random-draw-top-10', SelectionType.RANDOM_DRAW, true, true, 'Sweepstakes: 1 runner each, Top 10 points'],
      ['World Marathon Majors (men)', 'wmm-men-tiered-top-10', SelectionType.TIERED, true, true, 'Tiered: 1 runner per tier, Top 10 points'],
      ['World Marathon Majors (women)', 'wmm-women-budget-top-10', SelectionType.BUDGET_PICK, true, true, 'Budget: 4 runners under the cap, Top 10 points'],
      ['World Marathon Majors (women)', 'wmm-women-random-draw-top-10', SelectionType.RANDOM_DRAW, true, true, 'Sweepstakes: 1 runner each, Top 10 points'],
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
  it('seeds both NCAA Division I leagues with one pick-4 tiered and one pick-4 budget template and three random draws, Straight up, Escalating and Full, the Full one the default (#2164)', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.BASKETBALL } }, templateKey: { startsWith: 'ncaa-' }, contestFormat: ContestFormat.ROSTER },
      include: { sportLeague: { include: { sport: true } } },
      orderBy: [{ templateKey: 'asc' }],
    });

    const perLeague = (name: string, prefix: string) => [
      [name, `${prefix}-budget-pick-4`, SelectionType.BUDGET_PICK, true, true],
      [name, `${prefix}-random-draw-doubling`, SelectionType.RANDOM_DRAW, false, true],
      [name, `${prefix}-random-draw-doubling-upset-bonus`, SelectionType.RANDOM_DRAW, true, true],
      [name, `${prefix}-random-draw-straight-up`, SelectionType.RANDOM_DRAW, false, true],
      [name, `${prefix}-tiered-pick-4`, SelectionType.TIERED, true, true],
    ];
    expect(templates.map((template) => [
      template.sportLeague.name,
      template.templateKey,
      template.selectionType,
      template.isDefault,
      template.active,
    ])).toEqual([...perLeague('NCAA Men\'s Basketball', 'ncaa-men'), ...perLeague('NCAA Women\'s Basketball', 'ncaa-women')]);
    expect(new Set(templates.map((template) => template.sportLeague.sport.sport))).toEqual(new Set([Sport.BASKETBALL]));
  });

  it('presets round values 1, 2, 4, 8, 16 and 32 on every roster and bracket template but Straight up\'s 1 a round, with no upset bonus but on Full\'s seed difference times 1', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.BASKETBALL } }, templateKey: { startsWith: 'ncaa-' }, selectionType: { notIn: [SelectionType.SURVIVOR, SelectionType.SQUARES] } },
    });

    expect(templates).toHaveLength(16);
    for (const template of templates) {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      expect(rules.selectionType).toBe(template.selectionType);
      expect(rules.maxEntriesPerSquad).toBe(1);
      expect(rules.scoring).toEqual({
        participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
        config: {
          roundValues: template.templateKey.endsWith('-straight-up') ? DOUBLING_ROUND_VALUES.map(() => 1) : DOUBLING_ROUND_VALUES,
          upsetBonus: template.templateKey.endsWith('-upset-bonus')
            ? { rule: 'SEED_DIFFERENCE', multiplier: 1 }
            : { rule: 'NONE' },
        },
      });
    }
  });

  it('covers only the national championship game with each March Madness squares template, its tournament-wide squares deferred', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.BASKETBALL } }, selectionType: SelectionType.SQUARES },
      include: { slots: { include: { definition: { select: { slotKind: true } } } } },
      orderBy: { templateKey: 'asc' },
    });

    expect(templates.map((template) => [template.templateKey, template.slots.map((slot) => slot.definition.slotKind)])).toEqual([
      ['ncaa-men-squares', [SlotKind.FINAL]],
      ['ncaa-women-squares', [SlotKind.FINAL]],
    ]);
  });
});

// Soccer's competitions (#787): each a fixed knockout bracket, its presets doubling up to its
// final. The Copa América starts at the quarter-finals; the Champions League at its knockout
// play-offs, naming its own rounds. MLS starts at its wild card round, the NWSL at its
// quarterfinals, and each NCAA tournament at its first round, all naming their own rounds.
// Each row: name, key prefix, round values, the tiered and budget pick count (null: none, a
// playoff of eight teams or fewer), whether the field has seeds, and whether the league keeps one
// template per format (NCAA soccer, low interest: Derek, 2026-11-26).
const SOCCER_COMPETITIONS = [
  ['FIFA World Cup', 'world-cup', [1, 2, 4, 8, 16], 4, false, false],
  ['FIFA Women\'s World Cup', 'womens-world-cup', [1, 2, 4, 8], 4, false, false],
  ['UEFA European Championship', 'euro', [1, 2, 4, 8], 4, false, false],
  ['Copa América', 'copa-america', [1, 2, 4], null, false, false],
  ['UEFA Champions League', 'champions-league', [1, 2, 4, 8, 16], 4, false, false],
  ['MLS', 'mls', [1, 2, 4, 8, 16], 3, true, false],
  ['NWSL', 'nwsl', [1, 2, 4], null, true, false],
  ['NCAA Men\'s Soccer', 'ncaa-men-soccer', [1, 2, 4, 8, 16, 32], null, true, true],
  ['NCAA Women\'s Soccer', 'ncaa-women-soccer', [1, 2, 4, 8, 16, 32], null, true, true],
] as const;

describe('Seeded soccer competitions and their knockout templates', () => {
  it('seeds the ten soccer competitions, read back through the sport league repository, the leagues that name their knockout rounds naming them on their slots', async () => {
    const soccer = await getPrisma().sport.findUniqueOrThrow({ where: { sport: Sport.SOCCER } });
    const leagues = await new PrismaSportLeagueRepository(getAppPrisma()).findAll({ sportId: soccer.id });
    expect(leagues.map((league) => league.name)).toEqual([
      'Copa América', 'FIFA Women\'s World Cup', 'FIFA World Cup', 'MLS', 'NCAA Men\'s Soccer', 'NCAA Women\'s Soccer', 'NWSL',
      'Premier League', 'UEFA Champions League', 'UEFA European Championship',
    ]);
    // A round is named by its slot (#2006): the leagues that name their knockout rounds do so on their slot definitions.
    await expect(knockoutDefinitions('MLS')).resolves.toEqual([
      ['Wild Card', 'PLAY_IN', 'FIXED'], ['Round One', 'ROUND_OF_16', 'FIXED'], ['Conference Semifinals', 'QUARTERFINAL', 'FIXED'],
      ['Conference Finals', 'SEMIFINAL', 'FIXED'], ['MLS Cup', 'FINAL', 'FIXED'],
    ]);
    await expect(knockoutDefinitions('NWSL')).resolves.toEqual([[null, 'QUARTERFINAL', 'FIXED'], [null, 'SEMIFINAL', 'FIXED'], ['NWSL Championship', 'FINAL', 'FIXED']]);
  });

  it('starts squares at the Champions League final and the MLS conference semifinals, past their two-legged ties and best-of-three series, and every other soccer league at its first round', async () => {
    const soccer = await getPrisma().sport.findUniqueOrThrow({ where: { sport: Sport.SOCCER } });
    const leagues = await new PrismaSportLeagueRepository(getAppPrisma()).findAll({ sportId: soccer.id });

    expect(leagues.filter((league) => league.squaresFromRound !== null).map((league) => [league.name, league.squaresFromRound]))
      .toEqual([['MLS', 3], ['UEFA Champions League', 5]]);
  });

  it.each(SOCCER_COMPETITIONS)('gives %s its knockout templates (#2164): a tiered and budget pair on a playoff of more than eight teams, Straight up, Escalating and, with seeds, Full random draws and brackets, Full the default where seeded, and no squares', async (name, prefix, roundValues, rosterPicks, seeded, oneEach) => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.SOCCER }, name }, slots: { some: { definition: { slotKind: { not: SlotKind.WEEK } } } } },
      orderBy: [{ sortOrder: 'asc' }],
    });

    const { ALL_LISTED, FROM_SLOT } = TemplateCoverageMode;
    const expected = oneEach
      ? [
        [`${prefix}-random-draw-doubling-upset-bonus`, SelectionType.RANDOM_DRAW, ALL_LISTED, true],
        [`${prefix}-bracket-doubling`, SelectionType.BRACKET, ALL_LISTED, true],
      ]
      : [
        ...(rosterPicks === null ? [] : [
          [`${prefix}-tiered-pick-${rosterPicks}`, SelectionType.TIERED, ALL_LISTED, true],
          [`${prefix}-budget-pick-${rosterPicks}`, SelectionType.BUDGET_PICK, ALL_LISTED, true],
        ]),
        [`${prefix}-random-draw-straight-up`, SelectionType.RANDOM_DRAW, ALL_LISTED, false],
        [`${prefix}-random-draw-doubling`, SelectionType.RANDOM_DRAW, ALL_LISTED, !seeded],
        ...(seeded ? [[`${prefix}-random-draw-doubling-upset-bonus`, SelectionType.RANDOM_DRAW, ALL_LISTED, true]] : []),
        [`${prefix}-bracket-straight-up`, SelectionType.BRACKET, ALL_LISTED, false],
        [`${prefix}-bracket-doubling`, SelectionType.BRACKET, ALL_LISTED, !seeded],
        ...(seeded ? [[`${prefix}-bracket-doubling-upset-bonus`, SelectionType.BRACKET, ALL_LISTED, true]] : []),
        [`${prefix}-knockout-survivor`, SelectionType.SURVIVOR, FROM_SLOT, true],
      ];
    expect(templates.map((template) => [template.templateKey, template.selectionType, template.coverageMode, template.isDefault])).toEqual(expected);
    for (const template of templates) {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      if (rules.selectionType === SelectionType.SURVIVOR) continue;
      expect(rules.scoring).toEqual({
        participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
        config: {
          roundValues: template.templateKey.endsWith('-straight-up') ? roundValues.map(() => 1) : roundValues,
          upsetBonus: template.templateKey.endsWith('-upset-bonus') ? { rule: 'SEED_DIFFERENCE', multiplier: 1 } : { rule: 'NONE' },
        },
      });
      if (rules.selectionType === SelectionType.BUDGET_PICK) expect([rules.rosterSize, rules.countedScores]).toEqual([rosterPicks, rosterPicks]);
      if (rules.selectionType === SelectionType.TIERED) expect([rules.picksPerTier, rules.countedScores]).toEqual([1, rosterPicks]);
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
    'gives %s pick\'em for its group matchdays, straight up the default, each covering the matchdays of its one competition, and no matchday survivor',
    async (name, prefix) => {
      const templates = await getPrisma().contestConfigTemplate.findMany({
        where: { sportLeague: { sport: { sport: Sport.SOCCER }, name }, templateKey: { contains: 'matchday' } },
        include: { slots: true },
        orderBy: [{ sortOrder: 'asc' }],
      });

      // Each covers the league's WEEK slots, its matchdays (#2010, #2167): the Champions League's
      // eight league-phase weeks, and a tournament's three group matchdays, which sit in the one
      // competition with its knockout rounds.
      const matchdays = await getPrisma().sportLeagueCompetitionSlot.findMany({
        where: { sportLeague: { sport: { sport: Sport.SOCCER }, name }, slotKind: SlotKind.WEEK },
        select: { id: true, competition: { select: { slots: { select: { slotKind: true } } } } },
      });
      expect(templates.map((template) => [template.templateKey, template.selectionType, template.isDefault, template.slots.map((slot) => slot.sportLeagueCompetitionSlotId).sort()])).toEqual([
        [`${prefix}-matchday-pick-em-straight-up`, SelectionType.PICK_EM, true, matchdays.map((matchday) => matchday.id).sort()],
        [`${prefix}-matchday-pick-em-confidence`, SelectionType.PICK_EM, false, matchdays.map((matchday) => matchday.id).sort()],
      ]);
      expect(matchdays.length).toBe(name === 'UEFA Champions League' ? 8 : 3);
      // A tournament's matchdays share its competition with its knockout rounds; the Champions
      // League's league phase is a phase of its own.
      expect(matchdays.every((matchday) => matchday.competition.slots.some((slot) => slot.slotKind === SlotKind.FINAL))).toBe(name !== 'UEFA Champions League');
    },
  );
});

// Tennis (#704): the ATP and the WTA, each a fixed knockout draw of seven rounds, their presets
// doubling to 64 in the final, each on one tournament at a time (#2010); and the NCAA singles
// championships, draws of six rounds doubling to 32.
const TENNIS_ROUND_VALUES = [1, 2, 4, 8, 16, 32, 64];

describe('Seeded tennis tours and their knockout templates', () => {
  it('seeds the ATP, the WTA and the NCAA singles championships on tennis\'s tiers, the NCAA\'s six rounds as knockout slots named by kind', async () => {
    const tennis = await getPrisma().sport.findUniqueOrThrow({ where: { sport: Sport.TENNIS } });
    const leagues = await new PrismaSportLeagueRepository(getAppPrisma()).findAll({ sportId: tennis.id });
    expect(new Set(leagues.map((league) => league.participantType))).toEqual(new Set(['INDIVIDUAL']));
    const platformTierProfileCodes = new Map((await getPrisma().platformTierProfile.findMany()).map((profile) => [profile.id, profile.code]));
    expect(leagues.map((league) => [league.name, platformTierProfileCodes.get(league.platformTierProfileId)])).toEqual([
      ['ATP', 'TIERS_6_OF_8'],
      ['NCAA Men\'s Tennis', 'TIERS_6_OF_8'],
      ['NCAA Women\'s Tennis', 'TIERS_6_OF_8'],
      ['WTA', 'TIERS_6_OF_8'],
    ]);
    // An NCAA championship's rounds are its six knockout slots, named by kind; a tour's Slam is one TOURNAMENT slot.
    await expect(knockoutDefinitions('NCAA Men\'s Tennis')).resolves.toEqual(
      ['ROUND_OF_64', 'ROUND_OF_32', 'ROUND_OF_16', 'QUARTERFINAL', 'SEMIFINAL', 'FINAL'].map((slotKind) => [null, slotKind, 'FIXED']),
    );
  });

  it.each([
    ['ATP', 'atp', TemplateCoverageMode.ONE_SLOT, TENNIS_ROUND_VALUES],
    ['WTA', 'wta', TemplateCoverageMode.ONE_SLOT, TENNIS_ROUND_VALUES],
    ['NCAA Men\'s Tennis', 'ncaa-men-tennis', TemplateCoverageMode.ALL_LISTED, [1, 2, 4, 8, 16, 32]],
    ['NCAA Women\'s Tennis', 'ncaa-women-tennis', TemplateCoverageMode.ALL_LISTED, [1, 2, 4, 8, 16, 32]],
  ] as const)('gives %s ten knockout templates (#2164): tiered and budget twins over the whole field with all counting (the defaults) and the best four counting, all scored Full, three random draws and three brackets with Full the default, and no survivor', async (name, prefix, coverage, roundValues) => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.TENNIS }, name } },
      orderBy: [{ sortOrder: 'asc' }],
    });

    expect(templates.map((template) => [template.templateKey, template.selectionType, template.coverageMode, template.isDefault])).toEqual([
      [`${prefix}-tiered-doubling-upset-bonus`, SelectionType.TIERED, coverage, true],
      [`${prefix}-tiered-best-four-doubling-upset-bonus`, SelectionType.TIERED, coverage, false],
      [`${prefix}-budget-doubling-upset-bonus`, SelectionType.BUDGET_PICK, coverage, true],
      [`${prefix}-budget-best-four-doubling-upset-bonus`, SelectionType.BUDGET_PICK, coverage, false],
      [`${prefix}-random-draw-straight-up`, SelectionType.RANDOM_DRAW, coverage, false],
      [`${prefix}-random-draw-doubling`, SelectionType.RANDOM_DRAW, coverage, false],
      [`${prefix}-random-draw-doubling-upset-bonus`, SelectionType.RANDOM_DRAW, coverage, true],
      [`${prefix}-bracket-straight-up`, SelectionType.BRACKET, coverage, false],
      [`${prefix}-bracket-doubling`, SelectionType.BRACKET, coverage, false],
      [`${prefix}-bracket-doubling-upset-bonus`, SelectionType.BRACKET, coverage, true],
    ]);
    for (const template of templates) {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      expect(rules.scoring).toEqual({
        participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
        config: {
          roundValues: template.templateKey.endsWith('-straight-up') ? roundValues.map(() => 1) : roundValues,
          upsetBonus: template.templateKey.endsWith('-upset-bonus') ? { rule: 'SEED_DIFFERENCE', multiplier: 1 } : { rule: 'NONE' },
        },
      });
      const counted = template.templateKey.includes('best-four') ? 4 : 6;
      if (rules.selectionType === SelectionType.TIERED) expect([rules.picksPerTier, rules.countedScores]).toEqual([1, counted]);
      if (rules.selectionType === SelectionType.BUDGET_PICK) expect([rules.rosterSize, rules.countedScores]).toEqual([6, counted]);
    }
  });
});

// The NFL's knockout presets (#702): four playoff rounds, so the doubling stops at 8.
describe('The seeded NFL league and its knockout templates', () => {
  it('seeds the NFL, which reseeds, with Straight up, Escalating and Full random draws, Full the default (#2164), and one pick-3 tiered and one pick-3 budget template (#2160), all on round values 1, 2, 4, 8 but Straight up\'s 1 a round', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.FOOTBALL } }, templateKey: { startsWith: 'nfl-' }, contestFormat: ContestFormat.ROSTER },
      include: { sportLeague: true },
      orderBy: [{ templateKey: 'asc' }],
    });

    expect(new Set(templates.map((template) => template.sportLeague.name))).toEqual(new Set(['NFL']));
    // The NFL reseeds: every postseason slot it plays is RESEEDED (#2006).
    expect(new Set((await knockoutDefinitions('NFL')).map(([, , pairing]) => pairing))).toEqual(new Set(['RESEEDED']));
    expect(templates.map((template) => [template.templateKey, template.selectionType, template.isDefault])).toEqual([
      ['nfl-budget-pick-3', SelectionType.BUDGET_PICK, true],
      ['nfl-random-draw-doubling', SelectionType.RANDOM_DRAW, false],
      ['nfl-random-draw-doubling-upset-bonus', SelectionType.RANDOM_DRAW, true],
      ['nfl-random-draw-straight-up', SelectionType.RANDOM_DRAW, false],
      ['nfl-tiered-pick-3', SelectionType.TIERED, true],
    ]);
    for (const template of templates) {
      expect(ContestRulesWithEntryLimitSchema.parse(template.configJson).scoring).toEqual({
        participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
        config: {
          roundValues: template.templateKey.endsWith('-straight-up') ? [1, 1, 1, 1] : [1, 2, 4, 8],
          upsetBonus: template.templateKey.endsWith('-upset-bonus') ? { rule: 'SEED_DIFFERENCE', multiplier: 1 } : { rule: 'NONE' },
        },
      });
    }
  });

  // Squares (#711, #786, #2164): only on football and March Madness, each its league's default squares preset.
  it('seeds one squares template on the NFL and men\'s and women\'s March Madness and one on each of NCAA men\'s football\'s CFP, bowls and conference title games, the CFP\'s its default, and none on any hockey or soccer league, ten boxes per entry and one entry per squad', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { contestFormat: ContestFormat.SQUARES },
      include: { sportLeague: { include: { sport: true } } },
      orderBy: { templateKey: 'asc' },
    });

    expect(templates.map((template) => [template.templateKey, template.sportLeague.sport.sport, template.selectionType, template.isDefault, template.sportLeague.name])).toEqual([
      ['bowls-squares', Sport.FOOTBALL, SelectionType.SQUARES, false, 'NCAA Men\'s Football'],
      ['cfp-squares', Sport.FOOTBALL, SelectionType.SQUARES, true, 'NCAA Men\'s Football'],
      ['conference-championships-squares', Sport.FOOTBALL, SelectionType.SQUARES, false, 'NCAA Men\'s Football'],
      ['ncaa-men-squares', Sport.BASKETBALL, SelectionType.SQUARES, true, 'NCAA Men\'s Basketball'],
      ['ncaa-women-squares', Sport.BASKETBALL, SelectionType.SQUARES, true, 'NCAA Women\'s Basketball'],
      ['nfl-squares', Sport.FOOTBALL, SelectionType.SQUARES, true, 'NFL'],
    ]);
    for (const template of templates) {
      expect(ContestRulesWithEntryLimitSchema.parse(template.configJson))
        .toEqual({ selectionType: SelectionType.SQUARES, maxSquaresPerEntry: 10, maxEntriesPerSquad: 1 });
    }
  });

  it('gives each seeded league\'s slot definitions their period unit and count, one family each: quarters, halves, periods, innings, holes, and none for a race (#786, #2047)', async () => {
    const slots = await getPrisma().sportLeagueCompetitionSlot.findMany({
      where: { sportLeague: { name: { in: ['NFL', 'NBA', 'NCAA Men\'s Basketball', 'NHL', 'MLB', 'PGA TOUR', 'Formula 1'] } } },
      select: { periodUnit: true, periodCount: true, sportLeague: { select: { name: true } } },
    });
    const periodsByLeague = new Map<string, Set<string>>();
    for (const slot of slots) {
      const periods = slot.periodUnit === null ? 'none' : `${slot.periodUnit} x ${String(slot.periodCount)}`;
      periodsByLeague.set(slot.sportLeague.name, new Set([...(periodsByLeague.get(slot.sportLeague.name) ?? []), periods]));
    }
    expect(Object.fromEntries([...periodsByLeague].map(([league, periods]) => [league, [...periods]]))).toEqual({
      'NFL': ['QUARTER x 4'],
      'NBA': ['QUARTER x 4'],
      'NCAA Men\'s Basketball': ['HALF x 2'],
      'NHL': ['PERIOD x 3'],
      'MLB': ['INNING x 9'],
      'PGA TOUR': ['HOLE x 18'],
      'Formula 1': ['none'],
    });
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
      include: {
        sportLeague: { include: { platformTierProfile: { include: { _count: { select: { ranges: true } } } }, sport: true } },
        slots: { select: { sportLeagueCompetitionSlotId: true } },
      },
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
              template.sportLeague.platformTierProfile.tierCount ?? template.sportLeague.platformTierProfile._count.ranges,
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

  it('gives every tiered template a budget twin in its league, over the same slots with the same roster size, counted scores and scoring, with no exceptions', async () => {
    const templates = await activeTemplates();
    const rulesOf = (template: (typeof templates)[number]) => ContestRulesWithEntryLimitSchema.parse(template.configJson);
    const slotsOf = (template: (typeof templates)[number]) => template.slots.map((slot) => slot.sportLeagueCompetitionSlotId).sort().join(',');

    const untwinned = templates.flatMap((template) => {
      const rules = rulesOf(template);
      if (rules.selectionType !== SelectionType.TIERED) return [];
      const profile = template.sportLeague.platformTierProfile;
      const held = getTieredRosterSize(profile.tierCount ?? profile._count.ranges, rules.picksPerTier);
      const twinned = templates.some((other) => {
        if (other.sportLeagueId !== template.sportLeagueId || slotsOf(other) !== slotsOf(template)) return false;
        const budget = rulesOf(other);
        return budget.selectionType === SelectionType.BUDGET_PICK
          && budget.rosterSize === held
          && budget.countedScores === rules.countedScores
          && JSON.stringify(budget.scoring) === JSON.stringify(rules.scoring);
      });
      return twinned ? [] : [`${template.sportLeague.urlSegment}/${template.templateKey}`];
    }).sort();

    // A new tiered template comes with its budget twin (#2164 twinned the last of them).
    expect(untwinned).toEqual([]);
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
  it('gives each seeded sport league a roster default and a sweepstakes preset, every league keeping its random draw (#2164)', async () => {
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
      ...(sportAllowsSelectionType(definition, SelectionType.RANDOM_DRAW) && !offered.some((template) => template.selectionType === SelectionType.RANDOM_DRAW)
        ? [`${name}: no ${SelectionType.RANDOM_DRAW} preset`]
        : []),
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
  it('seeds the NBA and WNBA playoffs as fixed slots that name their own rounds, and the NCAA tournament\'s with March Madness names', async () => {
    await expect(knockoutDefinitions('NBA')).resolves.toEqual([
      ['Play-In Tournament', 'PLAY_IN', 'FIXED'], ['First Round', 'ROUND_OF_16', 'FIXED'], ['Conference Semifinals', 'QUARTERFINAL', 'FIXED'],
      ['Conference Finals', 'SEMIFINAL', 'FIXED'], ['NBA Finals', 'FINAL', 'FIXED'],
    ]);
    await expect(knockoutDefinitions('WNBA')).resolves.toEqual([['First Round', 'QUARTERFINAL', 'FIXED'], [null, 'SEMIFINAL', 'FIXED'], ['WNBA Finals', 'FINAL', 'FIXED']]);
    await expect(knockoutDefinitions('NCAA Men\'s Basketball')).resolves.toEqual([
      ['First Four', 'PLAY_IN', 'FIXED'], [null, 'ROUND_OF_64', 'FIXED'], [null, 'ROUND_OF_32', 'FIXED'], ['Sweet 16', 'ROUND_OF_16', 'FIXED'],
      ['Elite Eight', 'QUARTERFINAL', 'FIXED'], ['Final Four', 'SEMIFINAL', 'FIXED'], ['National Championship', 'FINAL', 'FIXED'],
    ]);
  });

  it.each([
    { league: 'NBA', prefix: 'nba', roundValues: [1, 2, 4, 8], rosterPicks: 3 },
    { league: 'WNBA', prefix: 'wnba', roundValues: [1, 2, 4], rosterPicks: null },
  ])('gives the $league Straight up, Escalating and Full random draws, Full the default, and a pick-3 tiered and budget pair only on a playoff of more than eight teams (#2164)', async ({ league, prefix, roundValues, rosterPicks }) => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { sport: { sport: Sport.BASKETBALL }, name: league }, contestFormat: ContestFormat.ROSTER },
      orderBy: [{ templateKey: 'asc' }],
    });

    expect(templates.map((template) => [template.templateKey, template.selectionType, template.isDefault])).toEqual([
      ...(rosterPicks === null ? [] : [[`${prefix}-budget-pick-${rosterPicks}`, SelectionType.BUDGET_PICK, true]]),
      [`${prefix}-random-draw-doubling`, SelectionType.RANDOM_DRAW, false],
      [`${prefix}-random-draw-doubling-upset-bonus`, SelectionType.RANDOM_DRAW, true],
      [`${prefix}-random-draw-straight-up`, SelectionType.RANDOM_DRAW, false],
      ...(rosterPicks === null ? [] : [[`${prefix}-tiered-pick-${rosterPicks}`, SelectionType.TIERED, true]]),
    ]);
    for (const template of templates) {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      expect(rules.scoring).toEqual({
        participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
        config: {
          roundValues: template.templateKey.endsWith('-straight-up') ? roundValues.map(() => 1) : roundValues,
          upsetBonus: template.templateKey.endsWith('-upset-bonus') ? { rule: 'SEED_DIFFERENCE', multiplier: 1 } : { rule: 'NONE' },
        },
      });
      if (rules.selectionType === SelectionType.BUDGET_PICK) expect([rules.rosterSize, rules.countedScores]).toEqual([rosterPicks, rosterPicks]);
    }
  });
});

// NCAA men's football (#707, renamed in #2143): a football sport league, data only, whose College
// Football Playoff has its own round names, its own six tiers and knockout presets for its four rounds.
describe('The seeded NCAA Men\'s Football league and its knockout templates', () => {
  it('seeds NCAA Men\'s Football with its College Football Playoff tiered by seed (#2164), its playoff rounds named on its slots', async () => {
    const football = await getPrisma().sport.findUniqueOrThrow({ where: { sport: Sport.FOOTBALL } });
    const seeded = seededLeagueReader(football.id);

    const [cfp, nfl] = await Promise.all([seeded('NCAA Men\'s Football'), seeded('NFL')]);

    const platformTierProfileCodes = new Map((await getPrisma().platformTierProfile.findMany()).map((profile) => [profile.id, profile.code]));
    expect(platformTierProfileCodes.get(cfp?.platformTierProfileId ?? '')).toBe('SEEDS_4_8_12');
    await expect(knockoutDefinitions('NCAA Men\'s Football')).resolves.toEqual([
      ['First Round', 'ROUND_OF_16', 'FIXED'], [null, 'QUARTERFINAL', 'FIXED'], [null, 'SEMIFINAL', 'FIXED'], ['National Championship', 'FINAL', 'FIXED'],
    ]);
    // The NFL keeps its playoff-seeds tier profile.
    expect(platformTierProfileCodes.get(nfl?.platformTierProfileId ?? '')).toBe('PLAYOFF_SEEDS_1_4_REST');
  });

  it('gives the College Football Playoff one pick-3 tiered and one pick-3 budget template and Straight up, Escalating and Full random draws, Full the default, on round values 1, 2, 4, 8 but Straight up\'s 1 a round (#2164)', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { urlSegment: 'ncaamf' }, contestFormat: ContestFormat.ROSTER, slots: { some: { definition: { competition: { code: 'CFP' } } } } },
      orderBy: [{ templateKey: 'asc' }],
    });

    expect(templates.map((template) => [template.templateKey, template.selectionType, template.isDefault])).toEqual([
      ['cfp-budget-pick-3', SelectionType.BUDGET_PICK, true],
      ['cfp-random-draw-doubling', SelectionType.RANDOM_DRAW, false],
      ['cfp-random-draw-doubling-upset-bonus', SelectionType.RANDOM_DRAW, true],
      ['cfp-random-draw-straight-up', SelectionType.RANDOM_DRAW, false],
      ['cfp-tiered-pick-3', SelectionType.TIERED, true],
    ]);
    for (const template of templates) {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      expect(rules.scoring).toEqual({
        participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
        config: {
          roundValues: template.templateKey.endsWith('-straight-up') ? [1, 1, 1, 1] : [1, 2, 4, 8],
          upsetBonus: template.templateKey.endsWith('-upset-bonus') ? { rule: 'SEED_DIFFERENCE', multiplier: 1 } : { rule: 'NONE' },
        },
      });
      if (rules.selectionType === SelectionType.TIERED) expect([rules.picksPerTier, rules.countedScores]).toEqual([1, 3]);
      if (rules.selectionType === SelectionType.BUDGET_PICK) expect([rules.rosterSize, rules.countedScores]).toEqual([3, 3]);
    }
  });

  it('gives the bowls pick\'em straight up (the league\'s pick\'em default) and against the spread, squares and a Straight up sweepstakes, and the conference title games the same but the sweepstakes, each covering only its own competition\'s slot, with no tiered or budget template', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeague: { urlSegment: 'ncaamf' }, slots: { some: { definition: { competition: { code: { in: ['BOWLS', 'CONFERENCE_CHAMPIONSHIPS'] } } } } } },
      include: { slots: { select: { definition: { select: { key: true, competition: { select: { code: true } } } } } } },
      orderBy: [{ sortOrder: 'asc' }],
    });

    expect(templates.map((template) => [
      template.templateKey,
      template.selectionType,
      template.isDefault,
      template.slots.map((slot) => `${slot.definition.competition.code} ${slot.definition.key}`),
    ])).toEqual([
      ['bowls-pick-em-straight-up', SelectionType.PICK_EM, true, ['BOWLS BOWLS']],
      ['bowls-pick-em-against-the-spread', SelectionType.PICK_EM, false, ['BOWLS BOWLS']],
      ['bowls-squares', SelectionType.SQUARES, false, ['BOWLS BOWLS']],
      ['conference-championships-pick-em-straight-up', SelectionType.PICK_EM, false, ['CONFERENCE_CHAMPIONSHIPS CONFERENCE_CHAMPIONSHIPS']],
      ['conference-championships-pick-em-against-the-spread', SelectionType.PICK_EM, false, ['CONFERENCE_CHAMPIONSHIPS CONFERENCE_CHAMPIONSHIPS']],
      ['conference-championships-squares', SelectionType.SQUARES, false, ['CONFERENCE_CHAMPIONSHIPS CONFERENCE_CHAMPIONSHIPS']],
      ['bowls-random-draw-straight-up', SelectionType.RANDOM_DRAW, false, ['BOWLS BOWLS']],
    ]);
    expect(templates.every((template) => template.coverageMode === TemplateCoverageMode.ONE_SLOT)).toBe(true);
    const pickEm = templates.filter((template) => template.selectionType === SelectionType.PICK_EM).map((template) => ContestRulesWithEntryLimitSchema.parse(template.configJson));
    expect(pickEm.map((rules) => rules.selectionType === SelectionType.PICK_EM && rules.againstTheSpread)).toEqual([false, true, false, true]);
    // The sweepstakes deals one bowl team each, and a bowl win scores its one round value.
    const sweepstakes = ContestRulesWithEntryLimitSchema.parse(templates.find((template) => template.selectionType === SelectionType.RANDOM_DRAW)?.configJson);
    expect(sweepstakes).toMatchObject({
      selectionType: SelectionType.RANDOM_DRAW, picksPerEntry: 1, countedScores: 1,
      scoring: { participantScoringDefinitionId: 'KNOCKOUT_ROUND_POINTS', config: { roundValues: [1], upsetBonus: { rule: 'NONE' } } },
    });
  });
});

// Create contest starts every format on a template (#802): a sport league offers exactly one
// default for each format it hosts, so a commissioner never starts from blank rules. Which formats
// a league hosts is its templates' to say (#2164 removed some formats from some leagues).
/** Leagues with no knockout events: a season of weeks and nothing else. */
const LEAGUES_PLAYED_ONLY_IN_WEEKS: readonly string[] = ['Premier League'];

/** What Create contest calls each format, which every template's name starts with. */
const FORMAT_NAMES = Object.fromEntries(
  Object.values(SelectionType).map((selectionType) => [selectionType, enumLabel('SelectionType', selectionType)]),
) as Record<SelectionType, string>;

describe('Every seeded sport league\'s default templates and their names (#802)', () => {
  it('offers each sport league exactly one default for every format it has templates for, whatever kind of event it is played on (#2010)', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({ where: { active: true }, include: { sportLeague: true } });

    const defaultsByFormat = new Map<string, number>();
    for (const template of templates) {
      const key = `${template.sportLeague.urlSegment} ${template.selectionType}`;
      defaultsByFormat.set(key, (defaultsByFormat.get(key) ?? 0) + (template.isDefault ? 1 : 0));
    }

    expect([...defaultsByFormat.keys()]).toEqual(expect.arrayContaining(['nfl TIERED', 'nba RANDOM_DRAW', 'f1 BUDGET_PICK']));
    expect([...defaultsByFormat].filter(([, defaults]) => defaults !== 1).map(([key, defaults]) => `${key}: ${defaults} defaults`)).toEqual([]);
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

  it('gives every seeded template, in an active or a switched-off league, at least one slot to cover, with no exceptions, so each has a slot a contest can be created on once its Season slots exist (#2167)', async () => {
    const prisma = getPrisma();
    const leagues = new Map((await prisma.sportLeague.findMany({ select: { id: true, isActive: true } })).map((league) => [league.id, league.isActive]));
    const all = await everyTemplate();
    const withoutSlots = all.filter((template) => template.slots.length === 0).map((template) => template.templateKey).sort();

    expect(new Set(all.map((template) => leagues.get(template.sportLeagueId)))).toEqual(new Set([true, false]));
    expect(withoutSlots).toEqual([]);
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

// The template data pass (#2164, Derek's review of 2026-11-26), held as rules over the model
// rather than league by league: a field has seeds when its league's tier profile orders by SEED,
// and a playoff is more than eight teams when it has a round of 16 or an earlier round.
/** NCAA soccer keeps one random draw (Full) and one bracket (Escalating): low expected interest (Derek, 2026-11-26). */
const LEAGUES_WITH_ONE_KNOCKOUT_TEMPLATE_EACH: readonly string[] = ['ncaams', 'ncaaws'];
const ROUNDS_OF_A_FIELD_OVER_EIGHT: readonly SlotKind[] = [SlotKind.ROUND_OF_64, SlotKind.ROUND_OF_32, SlotKind.ROUND_OF_16];

type KnockoutVariant = 'STRAIGHT_UP' | 'ESCALATING' | 'FULL';

describe('Seeded knockout templates follow the template review (#2164)', () => {
  async function knockoutTemplates() {
    const templates = await getPrisma().contestConfigTemplate.findMany({
      where: { selectionType: { in: [SelectionType.RANDOM_DRAW, SelectionType.BRACKET] } },
      include: {
        sportLeague: { select: { urlSegment: true, platformTierProfile: { select: { sources: { select: { basis: true } } } } } },
        slots: { select: { definition: { select: { slotKind: true, sportLeagueCompetitionId: true } } } },
      },
      orderBy: [{ sportLeague: { urlSegment: 'asc' } }, { sortOrder: 'asc' }],
    });
    return templates.flatMap((template) => {
      const rules = ContestRulesWithEntryLimitSchema.parse(template.configJson);
      if (rules.selectionType !== SelectionType.RANDOM_DRAW && rules.selectionType !== SelectionType.BRACKET) return [];
      if (rules.scoring?.participantScoringDefinitionId !== 'KNOCKOUT_ROUND_POINTS') return [];
      const { roundValues, upsetBonus } = rules.scoring.config;
      const variant: KnockoutVariant = roundValues.every((value) => value === 1)
        ? 'STRAIGHT_UP'
        : upsetBonus.rule === 'SEED_DIFFERENCE' ? 'FULL' : 'ESCALATING';
      return [{ template, rules, variant, seeded: template.sportLeague.platformTierProfile.sources.some((source) => source.basis === 'SEED') }];
    });
  }

  it('gives every knockout random draw and bracket Straight up, Escalating and Full where the field has seeds, Full the default, and Straight up and Escalating where it has none, Escalating the default; and a slate of one-off games Straight up alone, never the default (#2225)', async () => {
    const templates = await knockoutTemplates();
    // Each competition's knockout templates (#2153), or each set a template picks one slot from (a tennis tour's Slams).
    const groups = new Map<string, typeof templates>();
    for (const entry of templates) {
      const competitions = [...new Set(entry.template.slots.map((slot) => slot.definition.sportLeagueCompetitionId))].sort((a, b) => a.localeCompare(b)).join('+');
      const key = `${entry.template.sportLeague.urlSegment} ${competitions} ${entry.template.selectionType}`;
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }

    const problems = [...groups].flatMap(([key, group]) => {
      const [{ template, rules, seeded }] = group;
      const oneEach = LEAGUES_WITH_ONE_KNOCKOUT_TEMPLATE_EACH.includes(template.sportLeague.urlSegment);
      // A one-round table on a TOURNAMENT slot scores a slate of one-off games (a season's bowls),
      // each game its own final: a win is 1, so only Straight up applies, and the league's playoff
      // keeps its default. A one-round knockout template (a final alone) is no slate.
      const slate = rules.scoring?.participantScoringDefinitionId === 'KNOCKOUT_ROUND_POINTS' && rules.scoring.config.roundValues.length === 1
        && template.slots.every((slot) => slot.definition.slotKind === SlotKind.TOURNAMENT);
      const expected: KnockoutVariant[] = slate ? ['STRAIGHT_UP'] : oneEach
        ? [template.selectionType === SelectionType.RANDOM_DRAW ? 'FULL' : 'ESCALATING']
        : seeded ? ['STRAIGHT_UP', 'ESCALATING', 'FULL'] : ['STRAIGHT_UP', 'ESCALATING'];
      const expectedDefaults: KnockoutVariant[] = slate ? [] : [oneEach ? expected[0] : seeded ? 'FULL' : 'ESCALATING'];
      const variants = group.map((entry) => entry.variant);
      const defaults = group.filter((entry) => entry.template.isDefault).map((entry) => entry.variant);
      return [
        ...(JSON.stringify(variants) === JSON.stringify(expected) ? [] : [`${key}: ${variants.join(', ')}, not ${expected.join(', ')}`]),
        ...(JSON.stringify(defaults) === JSON.stringify(expectedDefaults) ? [] : [`${key}: default ${defaults.join(', ') || 'none'}, not ${expectedDefaults.join(', ') || 'none'}`]),
      ];
    });

    expect(groups.size).toBeGreaterThan(40);
    expect(problems).toEqual([]);
  });

  it('stores no template whose rules carry the retired bracket start round or tiers used, so every one parses under today\'s rules', async () => {
    const templates = await getPrisma().contestConfigTemplate.findMany({ select: { templateKey: true, configJson: true } });

    expect(templates.length).toBeGreaterThan(100);
    expect(templates.filter((template) => !ContestRulesWithEntryLimitSchema.safeParse(template.configJson).success).map((template) => template.templateKey)).toEqual([]);
  });

  it('offers tiered and budget on a knockout of more than eight teams, one that has a round of 16 or an earlier round, and on none smaller', async () => {
    const draws = (await knockoutTemplates()).filter((entry) => entry.template.selectionType === SelectionType.RANDOM_DRAW
      && entry.template.slots.every((slot) => slot.definition.slotKind !== SlotKind.TOURNAMENT && slot.definition.slotKind !== SlotKind.WEEK)
      && !LEAGUES_WITH_ONE_KNOCKOUT_TEMPLATE_EACH.includes(entry.template.sportLeague.urlSegment));
    const competitionIds = [...new Set(draws.flatMap((entry) => entry.template.slots.map((slot) => slot.definition.sportLeagueCompetitionId)))];
    const competitions = await getPrisma().sportLeagueCompetition.findMany({
      where: { id: { in: competitionIds } },
      select: { id: true, sportLeague: { select: { urlSegment: true } }, slots: { select: { slotKind: true } } },
    });
    const rosterTemplates = await getPrisma().contestConfigTemplate.findMany({
      where: { selectionType: { in: [SelectionType.TIERED, SelectionType.BUDGET_PICK] } },
      select: { selectionType: true, slots: { select: { definition: { select: { sportLeagueCompetitionId: true } } } } },
    });

    const problems = competitions.flatMap((competition) => {
      const overEight = competition.slots.some((slot) => ROUNDS_OF_A_FIELD_OVER_EIGHT.includes(slot.slotKind));
      const kinds = [...new Set(rosterTemplates
        .filter((template) => template.slots.some((slot) => slot.definition.sportLeagueCompetitionId === competition.id))
        .map((template) => template.selectionType))].sort();
      const expected = overEight ? [SelectionType.BUDGET_PICK, SelectionType.TIERED] : [];
      return JSON.stringify(kinds) === JSON.stringify(expected) ? [] : [`${competition.sportLeague.urlSegment}: ${kinds.join(', ') || 'none'}, not ${expected.join(', ') || 'none'}`];
    });

    expect(competitions.map((competition) => competition.sportLeague.urlSegment)).toEqual(expect.arrayContaining(['nfl', 'pwhl', 'wnba', 'copa-america', 'mls']));
    expect(problems).toEqual([]);
  });

  it('points each playoff at its agreed tier and pricing profiles: seed ranges where seeded, equal groups by odds where not', async () => {
    const leagues = await getPrisma().sportLeague.findMany({
      where: { urlSegment: { in: ['nfl', 'ncaamf', 'nba', 'nhl', 'mlb', 'mls', 'ncaamb', 'ncaawb', 'ncaamh', 'world-cup', 'womens-world-cup', 'euro', 'copa-america', 'ucl'] } },
      select: { urlSegment: true, platformTierProfile: { select: { code: true } }, platformPricingProfile: { select: { code: true } } },
      orderBy: { urlSegment: 'asc' },
    });

    expect(leagues.map((league) => [league.urlSegment, league.platformTierProfile.code, league.platformPricingProfile.code])).toEqual([
      ['copa-america', 'TIERS_4_OF_4_BY_ODDS', 'STANDARD'],
      ['euro', 'TIERS_4_OF_4_BY_ODDS', 'STANDARD'],
      ['mlb', 'SEEDS_2_4_REST', 'STANDARD_BY_SEED'],
      ['mls', 'SEEDS_3_6_REST', 'STANDARD_BY_SEED'],
      ['nba', 'SEEDS_2_5_REST', 'STANDARD_BY_SEED'],
      ['ncaamb', 'REGION_SEED_LINES_4', 'STANDARD_BY_SEED'],
      ['ncaamf', 'SEEDS_4_8_12', 'STANDARD_BY_SEED'],
      ['ncaamh', 'REGION_SEEDS_EACH', 'STANDARD_BY_SEED'],
      ['ncaawb', 'REGION_SEED_LINES_4', 'STANDARD_BY_SEED'],
      ['nfl', 'PLAYOFF_SEEDS_1_4_REST', 'STANDARD_BY_SEED'],
      ['nhl', 'SEEDS_1_2_REST', 'STANDARD_BY_SEED'],
      ['ucl', 'TIERS_4_OF_4_BY_ODDS', 'STANDARD'],
      ['womens-world-cup', 'TIERS_4_OF_4_BY_ODDS', 'STANDARD'],
      ['world-cup', 'TIERS_4_OF_8_BY_ODDS', 'STANDARD'],
    ]);
  });

  it.each([
    ['SEEDS_4_8_12', 12, [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]],
    ['SEEDS_2_5_REST', 10, [1, 1, 2, 2, 2, 3, 3, 3, 3, 3]],
    ['SEEDS_1_2_REST', 4, [1, 2, 3, 3]],
    ['SEEDS_2_4_REST', 6, [1, 1, 2, 2, 3, 3]],
    ['SEEDS_3_6_REST', 9, [1, 1, 1, 2, 2, 2, 3, 3, 3]],
    ['REGION_SEED_LINES_4', 16, [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]],
    ['REGION_SEEDS_EACH', 4, [1, 2, 3, 4]],
  ] as const)('tiers seeds 1 to %s\'s %i by its seed ranges, seed first, whatever the odds say', async (code, seedCount, tiers) => {
    const profile = await getPrisma().platformTierProfile.findUniqueOrThrow({
      where: { code },
      select: { type: true, sources: { orderBy: { orderIndex: 'asc' }, select: { basis: true } }, ranges: { orderBy: { tierNumber: 'asc' } } },
    });
    const seeds = Array.from({ length: seedCount }, (_, index) => index + 1);

    expect([profile.type, profile.sources.map((source) => source.basis)]).toEqual(['RANGES', ['SEED', 'ODDS', 'RANKING']]);
    expect(placeInRanges(profile.ranges, profile.ranges.length, seeds).map((index) => (index === null ? null : index + 1))).toEqual(tiers);
  });

  it('names no template "Quick pick": random draw is Sweepstakes on screen (#2174)', async () => {
    const names = (await getPrisma().contestConfigTemplate.findMany({ select: { name: true } })).map((template) => template.name);

    expect(names.filter((name) => name.startsWith('Quick pick'))).toEqual([]);
    expect(names.filter((name) => name.startsWith(`${enumLabel('SelectionType', SelectionType.RANDOM_DRAW)}:`)).length).toBeGreaterThan(30);
  });
});

/**
 * A champion's run through the bracket rounds `slotKinds` names, first round first: one match a
 * round, the champion winning each against a fresh opponent. Each round is one match, so each is
 * decided by its one result.
 */
/** A contest covering every round of `championRun`'s event: each round's slot definition. */
function everyRound(slotKinds: readonly SlotKind[]): ContestRoundCoverage {
  return { slotDefinitionIds: slotKinds.map((slotKind) => roundSlot(slotKind).slotDefinitionId) };
}

function championRun(slotKinds: readonly SlotKind[]): SportEventParticipantView[] {
  const store = new InMemorySportEvents();
  const sport = store.addSport(Sport.SOCCER);
  const event = store.addEvent({ sport: Sport.SOCCER, rounds: slotKinds.length });
  const team = (name: string) => {
    const participant = store.addParticipant(sport.id, name, { participantType: 'TEAM' });
    return { entry: store.addToField(event.id, participant.id), participant };
  };
  const champion = team('Champion');
  const opponents = slotKinds.map((_, index) => team(`Opponent ${String(index + 1)}`));
  const matches: SportEventRoundMatch[] = slotKinds.map((slotKind, index) => legacyMatch({
    id: `match-${String(index + 1)}`,
    sportEventId: event.id,
    roundNumber: index + 1,
    slot: roundSlot(slotKind),
    matchNumber: index + 1,
    homeSportEventParticipantId: champion.entry.id,
    awaySportEventParticipantId: opponents[index].entry.id,
    isNeutralSite: true,
    scheduledDate: null,
    status: MatchStatus.COMPLETED,
    winnerSide: MatchSide.HOME,
    homeScore: 1,
    awayScore: 0,
    homeShootoutScore: null,
    awayShootoutScore: null,
    ending: MatchEnding.PLAYED,
    advancesToMatchId: index + 1 < slotKinds.length ? `match-${String(index + 2)}` : null,
    advancesToSide: index + 1 < slotKinds.length ? MatchSide.HOME : null,
    regionLabel: null,
    homeSpread: null,
    resultSource: null,
    completedAt: null,
    periodScores: [],
    createdAt: new Date('2030-07-19T19:00:00.000Z'),
    updatedAt: new Date('2030-07-19T21:00:00.000Z'),
  }));
  return [champion, ...opponents].map(({ entry, participant }) => ({
    entry,
    participant,
    valuation: null,
    standing: null,
    rounds: [],
    fieldResults: [],
    matches: matches.filter((match) => match.sides.some((side) => side.sportEventParticipantId === entry.id)),
    affiliatedWithSportLeague: true,
  }));
}

describe('Seeded knockout round points cover every round a template lists', () => {
  /**
   * Every template a knockout round-points contest scores a whole bracket by: it covers all its
   * listed slots, none of them a tournament (an event of its own, whose rounds its slots do not
   * show). Each listed slot is a round of the bracket but the third-place play-off, a match beside
   * the bracket that is no round of it. Spelled out here, apart from the shared rule, so the two
   * check each other.
   */
  async function bracketTemplates() {
    const all = await new PrismaContestConfigTemplateRepository(getAppPrisma()).list();
    return all.flatMap((template) => {
      const scoring = template.configJson.scoring;
      if (template.coverageMode !== TemplateCoverageMode.ALL_LISTED || scoring?.participantScoringDefinitionId !== 'KNOCKOUT_ROUND_POINTS') return [];
      if (template.slots.some((slot) => slot.slotKind === SlotKind.TOURNAMENT)) return [];
      const rounds = template.slots.filter((slot) => slot.slotKind !== SlotKind.THIRD_PLACE).map((slot) => slot.slotKind);
      return [{ template, roundValues: scoring.config.roundValues, upsetBonus: scoring.config.upsetBonus, rounds }];
    });
  }

  it('gives every knockout round-points template one round value for each bracket round it lists, so no round, the final included, scores nothing, and the MLS and Champions League templates list the play-in round they score first', async () => {
    const templates = await bracketTemplates();
    const problems = templates.flatMap(({ template, roundValues, rounds }) => (roundValues.length === rounds.length
      ? []
      : [`${template.templateKey}: ${String(roundValues.length)} round values for ${String(rounds.length)} rounds (${rounds.join(', ')})`]));

    expect(templates.length).toBeGreaterThan(50);
    expect(problems).toEqual([]);
    expect(templates.filter(({ template }) => ['mls-bracket-doubling', 'champions-league-bracket-doubling'].includes(template.templateKey)).map(({ rounds }) => rounds))
      .toEqual(Array.from({ length: 2 }, () => [SlotKind.PLAY_IN, SlotKind.ROUND_OF_16, SlotKind.QUARTERFINAL, SlotKind.SEMIFINAL, SlotKind.FINAL]));
  });

  it('scores a champion who wins every round a knockout template lists the sum of its round values, the final its last value, in every league', async () => {
    const problems = (await bracketTemplates()).flatMap(({ template, roundValues, upsetBonus, rounds }) => {
      const [champion] = scoreKnockoutField(championRun(rounds), { roundValues, upsetBonus }, everyRound(rounds));
      const expected = roundValues.reduce((total, value) => total + value, 0);
      return champion.score === expected ? [] : [`${template.templateKey}: the champion scores ${String(champion.score)}, not ${String(expected)}`];
    });

    expect(problems).toEqual([]);
  });

  it('scores a FIFA World Cup champion 1 point in the Round of 32, doubling each round to 16 in the final, under Escalating', async () => {
    const template = (await bracketTemplates()).find((each) => each.template.templateKey === 'world-cup-random-draw-doubling');
    const { roundValues, upsetBonus, rounds } = expectDefined(template, 'the World Cup\'s Escalating random draw');
    const [champion] = scoreKnockoutField(championRun(rounds), { roundValues, upsetBonus }, everyRound(rounds));

    expect(rounds).toEqual([SlotKind.ROUND_OF_32, SlotKind.ROUND_OF_16, SlotKind.QUARTERFINAL, SlotKind.SEMIFINAL, SlotKind.FINAL]);
    expect(roundValues).toEqual([1, 2, 4, 8, 16]);
    expect(champion.score).toBe(31);
  });
});
