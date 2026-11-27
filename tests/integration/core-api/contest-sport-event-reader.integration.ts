import { compareSlotDefinitions, type ContestScoringSettings } from '@poolmaster/shared/domain';
import { cleanupTestData, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import {
  PrismaSportEventParticipantRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundMatchRepository,
  PrismaSportEventRoundRepository,
  PrismaSportEventSlotParticipantValuationRepository,
  PrismaSportEventSlotTierRepository,
} from '../../../packages/core-api/src/adapters';
import { createContestSportEventReader } from '../../../packages/core-api/src/modules/contest-management/contest-sport-event-reader';
import { fixtureSeasonId, putEventInSlot } from '../../support/event-edition';
import { expectDefined } from '../../support/expect-defined';

// Contest creation's event reads against real Postgres (#2241): a soccer tournament's sweepstake is
// drawn before the group stage, when the event has its rounds, one per slot, and no knockout game
// yet. Its knockout rounds are counted from those rounds' slots, so the draw's round values fit,
// and knockout round points take the event, its bracket checked as the sync places its games.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(() => cleanupTestData());

function reader() {
  const prisma = getAppPrisma();
  return createContestSportEventReader({
    sportEvents: new PrismaSportEventRepository(prisma),
    field: new PrismaSportEventParticipantRepository(prisma),
    tiers: new PrismaSportEventSlotTierRepository(prisma),
    valuations: new PrismaSportEventSlotParticipantValuationRepository(prisma),
    matches: new PrismaSportEventRoundMatchRepository(prisma),
    rounds: new PrismaSportEventRoundRepository(prisma),
  });
}

/** A World Cup event in every slot of the tournament's competition, a round per slot in play order, with no games. */
async function worldCupBeforeTheGroupStage() {
  const prisma = getPrisma();
  const league = await prisma.sportLeague.findFirstOrThrow({ where: { urlSegment: 'world-cup' }, select: { id: true } });
  const event = await prisma.sportEvent.create({
    data: {
      sportLeagueId: league.id,
      sportLeagueSeasonId: await fixtureSeasonId(prisma, league.id, 2098),
      name: 'Reader World Cup',
      startDate: new Date('2098-06-11T16:00:00.000Z'),
    },
    select: { id: true, sportLeagueId: true },
  });
  const definitions = (await prisma.sportLeagueCompetitionSlot.findMany({
    where: { sportLeagueId: league.id },
    select: { id: true, slotKind: true, weekNumber: true, key: true },
  })).sort(compareSlotDefinitions);
  for (const [index, definition] of definitions.entries()) {
    // poolmaster-allow-query-in-loop: one Season slot and round per slot definition, in play order
    const seasonSlotId = await putEventInSlot(prisma, event.id, definition.id);
    const { id: sportEventSlotId } = await prisma.sportEventSlot.findFirstOrThrow({ where: { sportEventId: event.id, sportLeagueSeasonCompetitionSlotId: seasonSlotId }, select: { id: true } });
    await prisma.sportEventRound.create({ data: { sportEventId: event.id, sportEventSlotId, roundNumber: index + 1, scheduledDate: new Date(Date.UTC(2098, 5, 11 + index * 4)) } });
  }
  return { event, definitions };
}

describe('createContestSportEventReader over a soccer tournament before its group stage (#2241)', () => {
  it('counts the sweepstake\'s covered knockout rounds from the event\'s rounds, one value of the draw for each, though no game is placed', async () => {
    const { event, definitions } = await worldCupBeforeTheGroupStage();
    const draws = await getPrisma().contestConfigTemplate.findMany({
      where: { sportLeagueId: event.sportLeagueId, selectionType: 'RANDOM_DRAW' },
      select: { templateKey: true, configJson: true, slots: { select: { sportLeagueCompetitionSlotId: true } } },
    });
    expect(draws.length).toBeGreaterThan(0);

    for (const draw of draws) {
      const listed = draw.slots.map((slot) => slot.sportLeagueCompetitionSlotId);
      const scoring = expectDefined((draw.configJson as { scoring?: ContestScoringSettings }).scoring, draw.templateKey);
      if (scoring.participantScoringDefinitionId !== 'KNOCKOUT_ROUND_POINTS') throw new Error(`${draw.templateKey} is not scored by knockout round points`);
      // poolmaster-allow-query-in-loop: one count per seeded draw template
      const covered = await reader().countCoveredRounds(event.id, { slotDefinitionIds: listed });

      // Each draw covers every slot of the competition, and gives one value per knockout round.
      expect([draw.templateKey, listed.length, covered]).toEqual([draw.templateKey, definitions.length, scoring.config.roundValues.length]);
    }
    // Five knockout rounds, Round of 32 to the final: the matchdays and the third-place play-off are none.
    await expect(reader().countCoveredRounds(event.id, { slotDefinitionIds: definitions.map((definition) => definition.id) })).resolves.toBe(5);
  });

  it('lets knockout round points take the event while its knockout has no games, and a bracket still waits for its games', async () => {
    const { event } = await worldCupBeforeTheGroupStage();

    await expect(reader().findKnockoutProblem(event.id)).resolves.toBeNull();
    await expect(reader().findBracketProblem(event.id)).resolves.toBe('it has no games');
  });
});
