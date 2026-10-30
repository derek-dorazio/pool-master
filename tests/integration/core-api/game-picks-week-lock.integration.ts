/**
 * #1268 — a week of game picks is judged under the entry's lock, against real Postgres. A submit
 * and a change to the same week can both load it before either writes; whichever writes second
 * must judge the week the first one left, not the week it loaded. Each case pins both sides: the
 * second request reaches its write, having loaded the week, before the first may write, and then
 * waits until the first has committed, so the interleaving is the same on every run.
 */
import { expect } from '@jest/globals';
import {
  ContestEntryStatus,
  ContestStatus,
  PickEmMode,
  PredictedResult,
  SelectionType,
  SportEventStatus,
  contestEntryEventStatus,
} from '@poolmaster/shared/domain';
import type { ContestEntryMatchPredictionRepository } from '@poolmaster/shared/db';
import {
  PrismaContestConfigurationRepository,
  PrismaContestEntryMatchPredictionRepository,
  PrismaContestEntryRepository,
  PrismaContestRepository,
  PrismaParticipantContestScoringRuleRepository,
  PrismaParticipantRepository,
  PrismaSportEventMatchRepository,
  PrismaSportEventParticipantRepository,
  PrismaSportEventRepository,
  PrismaSquadMembershipRepository,
} from '../../../packages/core-api/src/adapters';
import { PredictionService } from '../../../packages/core-api/src/modules/selections/prediction-service';
import { expectDefined } from '../../support/expect-defined';
import { cleanupTestData, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { DAY, seedFootballWeek, seedLeagueWithTeams } from '../list-route-seeds';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

/** Resolves once `open` is called. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

/** A prediction service on the real adapters whose predictions wait for `before` ahead of each write. */
function predictionService(before: () => Promise<void> = async () => {}) {
  const prisma = getPrisma();
  const real = new PrismaContestEntryMatchPredictionRepository(prisma);
  const predictions: ContestEntryMatchPredictionRepository = {
    findByEntryAndEvent: (...args) => real.findByEntryAndEvent(...args),
    findByEntriesAndEvent: (...args) => real.findByEntriesAndEvent(...args),
    findByEntriesAndEvents: (...args) => real.findByEntriesAndEvents(...args),
    hasAnyOnMatch: (...args) => real.hasAnyOnMatch(...args),
    save: async (change) => {
      await before();
      return real.save(change);
    },
  };
  return new PredictionService({
    contests: new PrismaContestRepository(prisma),
    configurations: new PrismaContestConfigurationRepository(prisma),
    scoringRules: new PrismaParticipantContestScoringRuleRepository(prisma),
    entries: new PrismaContestEntryRepository(prisma),
    squadMemberships: new PrismaSquadMembershipRepository(prisma),
    sportEvents: new PrismaSportEventRepository(prisma),
    matches: new PrismaSportEventMatchRepository(prisma),
    field: new PrismaSportEventParticipantRepository(prisma),
    participants: new PrismaParticipantRepository(prisma),
    predictions,
  });
}

/**
 * Two services for one race. `second`'s request loads the week, says it has reached its write,
 * and waits there until `first`'s request has committed; `first` writes only once `second` has
 * reached its write. Call `firstDone` when `first`'s request settles.
 */
function race() {
  const reachedWrite = gate();
  const firstCommitted = gate();
  return {
    first: predictionService(() => reachedWrite.opened),
    second: predictionService(async () => {
      reachedWrite.open();
      await firstCommitted.opened;
    }),
    firstDone: firstCommitted.open,
  };
}

/** An OPEN straight-up pick'em pool over a three-game week next month, one entry with every game picked and its tiebreaker given, still a draft. */
async function seedPickedWeek() {
  const prisma = getPrisma();
  const seeded = await seedLeagueWithTeams(1);
  const squad = expectDefined(seeded.squads[0]);
  const { event, games } = await seedFootballWeek({ games: 3, startDate: new Date(Date.now() + 30 * DAY), status: SportEventStatus.SCHEDULED });
  const contest = await prisma.contest.create({
    data: {
      leagueId: seeded.league.id,
      seasonYear: event.startDate.getUTCFullYear(),
      sportEvents: { create: [{ sportEventId: event.id, sequence: 1 }] },
      name: `Week lock ${seeded.suffix}`,
      status: ContestStatus.OPEN,
      contestFormat: 'PREDICTION',
      selectionType: SelectionType.PICK_EM,
    },
  });
  await prisma.contestConfiguration.create({
    data: {
      contestId: contest.id,
      selectionType: SelectionType.PICK_EM,
      configJson: { selectionType: SelectionType.PICK_EM, mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false },
    },
  });
  const entry = await prisma.contestEntry.create({
    data: { contestId: contest.id, squadId: squad.id, entryNumber: 1, name: squad.name, events: { create: [{ sportEventId: event.id, tiebreakerValue: 41 }] } },
  });
  await prisma.contestEntryMatchPrediction.createMany({
    data: games.map((game) => ({
      contestEntryId: entry.id,
      sportEventMatchId: game.id,
      predictedResult: PredictedResult.TEAM,
      sportEventParticipantId: expectDefined(game.homeSportEventParticipantId),
      pickedAt: new Date(),
    })),
  });
  const owner = await prisma.squadMembership.findFirstOrThrow({ where: { squadId: squad.id } });
  const week = { contestId: contest.id, entryId: entry.id, sportEventId: event.id, actorUserId: owner.userId };
  /** The week as it was left: its status, and how many of its games have a pick. */
  const stored = async () => {
    const after = expectDefined(await new PrismaContestEntryRepository(prisma).findByIdWithSquad(entry.id));
    return {
      status: contestEntryEventStatus(after, event.id),
      pickedCount: await prisma.contestEntryMatchPrediction.count({ where: { contestEntryId: entry.id } }),
    };
  };
  return { week, games, stored };
}

describe('a week of game picks judged under the entry\'s lock (#1268)', () => {
  it('refuses a submit whose week lost a pick to a clear that committed while the submit waited to write, leaving the week a draft', async () => {
    const { week, games, stored } = await seedPickedWeek();
    const { first, second, firstDone } = race();

    const [submit, clear] = await Promise.allSettled([
      second.submitGamePicks(week),
      first.clearGamePick({ ...week, sportEventMatchId: expectDefined(games[0]).id }).finally(firstDone),
    ]);

    expect(clear.status).toBe('fulfilled');
    expect(submit).toMatchObject({ status: 'rejected', reason: { code: 'PREDICTION_WEEK_INCOMPLETE', statusCode: 409 } });
    await expect(stored()).resolves.toEqual({ status: ContestEntryStatus.DRAFT, pickedCount: 2 });
  });

  it('sends a week back to draft when a clear that loaded it as a draft writes after a submit committed', async () => {
    const { week, games, stored } = await seedPickedWeek();
    const { first, second, firstDone } = race();

    const [clear, submit] = await Promise.allSettled([
      second.clearGamePick({ ...week, sportEventMatchId: expectDefined(games[0]).id }),
      first.submitGamePicks(week).finally(firstDone),
    ]);

    expect(submit.status).toBe('fulfilled');
    expect(clear).toMatchObject({ status: 'fulfilled', value: { status: ContestEntryStatus.DRAFT, pickedCount: 2 } });
    await expect(stored()).resolves.toEqual({ status: ContestEntryStatus.DRAFT, pickedCount: 2 });
  });

  it('refuses a submit whose week lost its tiebreaker to a save that committed while the submit waited to write', async () => {
    const { week, stored } = await seedPickedWeek();
    const { first, second, firstDone } = race();

    const [submit, save] = await Promise.allSettled([
      second.submitGamePicks(week),
      first.saveGamePicks({ ...week, picks: [], tiebreakerValue: null }).finally(firstDone),
    ]);

    expect(save.status).toBe('fulfilled');
    expect(submit).toMatchObject({ status: 'rejected', reason: { code: 'PREDICTION_TIEBREAKER_MISSING' } });
    await expect(stored()).resolves.toEqual({ status: ContestEntryStatus.DRAFT, pickedCount: 3 });
  });

  it('submits a complete week, and a second submit of it changes nothing', async () => {
    const { week, stored } = await seedPickedWeek();

    const view = await predictionService().submitGamePicks(week);
    const again = await predictionService().submitGamePicks(week);

    expect(view).toMatchObject({ status: ContestEntryStatus.SUBMITTED, pickedCount: 3, canSubmit: false });
    expect(again.submittedAt).toEqual(view.submittedAt);
    await expect(stored()).resolves.toEqual({ status: ContestEntryStatus.SUBMITTED, pickedCount: 3 });
  });
});
