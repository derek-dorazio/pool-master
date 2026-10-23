import { randomUUID } from 'node:crypto';
import { ContestStatus, ContestTemplateEventType, SelectionType, Sport } from '@poolmaster/shared/domain';
import {
  PrismaContestConfigTemplateRepository,
  PrismaContestConfigurationRepository,
  PrismaContestEntryPickRepository,
  PrismaContestEntryEventStandingRepository,
  PrismaContestEntryRepository,
  PrismaContestEntryStandingRepository,
  PrismaContestRepository,
  PrismaEmailMessageRepository,
  PrismaParticipantContestScoringRuleRepository,
  PrismaStandingsEmailPositionRepository,
} from '../../../packages/core-api/src/adapters';
import { createEventLifecycleService } from '../../../packages/core-api/src/modules/events/wiring';
import {
  cleanupTestData,
  createTestUser,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { freshEventEdition } from '../../support/event-edition';
import { mockFn } from '../../support/mock-fn';
import { expectDefined } from '../../support/expect-defined';
import type { MailDeliveryProvider } from '../../../packages/core-api/src/modules/email/mail-delivery';
import { deliverQueuedEmail, emailServiceOver } from '../../support/email-service';
import { EMAIL_SETTINGS } from '../../../packages/core-api/src/modules/email';
import { createContestNotices, createEntryReminders } from '../../../packages/core-api/src/modules/notifications';
import { fakeLogger } from '../../support/fake-logger';

// The contest-cluster ports (#247) against real Postgres: what each read returns and in what
// order, what each write leaves behind, and that deleting a contest takes everything under it.
// No mocks.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(async () => {
  await cleanupTestData();
});

function repos() {
  const prisma = getPrisma();
  return {
    contests: new PrismaContestRepository(prisma),
    entries: new PrismaContestEntryRepository(prisma),
    picks: new PrismaContestEntryPickRepository(prisma),
    standings: new PrismaContestEntryStandingRepository(prisma),
    eventStandings: new PrismaContestEntryEventStandingRepository(prisma),
  };
}

/** A league with two squads, and a golf event with three golfers on its field. */
async function createLeagueAndEvent() {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const owner = await createTestUser({ displayName: `Contest Repo ${suffix}` });
  const league = await prisma.league.create({
    data: { cupName: 'Test Cup', leagueCode: `CREPO${suffix.toUpperCase()}`, name: `Contest Repo League ${suffix}` },
  });
  await prisma.leagueMembership.create({
    data: { leagueId: league.id, userId: owner.user.id, role: 'COMMISSIONER', status: 'ACTIVE', joinedAt: new Date() },
  });
  const [alpha, bravo] = await Promise.all([
    prisma.squad.create({ data: { leagueId: league.id, createdBy: owner.user.id, name: `Alpha ${suffix}` } }),
    prisma.squad.create({ data: { leagueId: league.id, createdBy: owner.user.id, name: `Bravo ${suffix}` } }),
  ]);
  const sport = await prisma.sport.upsert({
    where: { sport: Sport.GOLF },
    create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
    update: {},
  });
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `contest-repo-${suffix}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name: `Contest Repo Open ${suffix}`,
      startDate: new Date('2026-06-04T12:00:00.000Z'),
      endDate: new Date('2026-06-07T12:00:00.000Z'),
      status: 'SCHEDULED',
    },
  });
  const field = [];
  for (const [name, role] of [['Golfer One', 'GOLFER'], ['Golfer Two', null], ['Golfer Three', null]] as const) {
    const participant = await prisma.participant.create({
      data: { sportId: sport.id, name: `${name} ${suffix}`, participantType: 'INDIVIDUAL', status: 'ACTIVE', role },
    });
    field.push(await prisma.sportEventParticipant.create({
      data: { sportEventId: event.id, participantId: participant.id, isActive: true },
    }));
  }
  return { owner, league, squads: [alpha, bravo] as const, event, field, suffix };
}

/** A second golf event with a two-golfer field, starting after the first. */
async function createLaterEvent(suffix: string, startDate = new Date('2026-07-16T12:00:00.000Z')) {
  const prisma = getPrisma();
  const sport = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
  const event = await prisma.sportEvent.create({
    data: {
      ...(await freshEventEdition(prisma)),
      externalId: `contest-repo-later-${suffix}-${randomUUID().slice(0, 4)}`,
      providerId: 'integration-test',
      sport: Sport.GOLF,
      name: `Contest Repo Later Open ${suffix}`,
      startDate,
      status: 'SCHEDULED',
    },
  });
  const field = [];
  for (const name of ['Later One', 'Later Two']) {
    const participant = await prisma.participant.create({
      data: { sportId: sport.id, name: `${name} ${suffix}`, participantType: 'INDIVIDUAL', status: 'ACTIVE' },
    });
    field.push(await prisma.sportEventParticipant.create({
      data: { sportEventId: event.id, participantId: participant.id, isActive: true },
    }));
  }
  return { event, field };
}

async function createContest(
  leagueId: string,
  sportEventId: string | readonly string[],
  name: string,
  status: ContestStatus = ContestStatus.ACTIVE,
) {
  return repos().contests.create({
    leagueId,
    seasonYear: 2026,
    sportEventIds: typeof sportEventId === 'string' ? [sportEventId] : [...sportEventId],
    name,
    status,
    contestFormat: 'ROSTER',
    selectionType: 'TIERED',
  });
}

/** An entry made through the port, so it carries a DRAFT status row in each contest event, as production's do. */
async function createEntry(contestId: string, squadId: string, entryNumber: number, name: string) {
  const result = await repos().entries.create({ contestId, squadId, entryNumber, name, tiebreakerValue: null });
  if (result.status !== 'created') throw new Error(`seed: entry ${name} refused (${result.status})`);
  return result.entry;
}

/** An entry's event statuses as [event, status] pairs, by event id. */
function byEvent(events: ReadonlyArray<{ sportEventId: string; status: string }>) {
  return events.map((row) => [row.sportEventId, row.status]).sort(([left], [right]) => left.localeCompare(right));
}

describe('ContestRepository', () => {
  it('creates a contest and reads it back with its event\'s sport', async () => {
    const { league, event } = await createLeagueAndEvent();

    const created = await createContest(league.id, event.id, 'Created Contest', ContestStatus.DRAFT);

    expect(created).toEqual(expect.objectContaining({
      leagueId: league.id,
      sportEventIds: [event.id],
      name: 'Created Contest',
      status: ContestStatus.DRAFT,
      contestFormat: 'ROSTER',
      selectionType: 'TIERED',
      sport: Sport.GOLF,
    }));
    await expect(repos().contests.findById(created.id)).resolves.toEqual(created);
  });

  it('finds an event\'s contests oldest first, leaving out the excluded statuses', async () => {
    const { league, event } = await createLeagueAndEvent();
    const active = await createContest(league.id, event.id, 'Active');
    const completed = await createContest(league.id, event.id, 'Completed', ContestStatus.COMPLETED);
    const draft = await createContest(league.id, event.id, 'Draft', ContestStatus.DRAFT);
    const open = await createContest(league.id, event.id, 'Open', ContestStatus.OPEN);

    const all = await repos().contests.findBySportEvent(event.id);
    const unsettled = await repos().contests.findBySportEvent(event.id, {
      excludeStatuses: [ContestStatus.DRAFT, ContestStatus.COMPLETED],
    });

    expect(all.map((contest) => contest.id)).toEqual([active.id, completed.id, draft.id, open.id]);
    expect(unsettled.map((contest) => contest.id)).toEqual([active.id, open.id]);
  });

  it('narrows an event\'s contests to some statuses', async () => {
    const { league, event } = await createLeagueAndEvent();
    await createContest(league.id, event.id, 'Draft', ContestStatus.DRAFT);
    const open = await createContest(league.id, event.id, 'Open', ContestStatus.OPEN);
    const live = await createContest(league.id, event.id, 'Live', ContestStatus.ACTIVE);

    const pending = await repos().contests.findBySportEvent(event.id, {
      statuses: [ContestStatus.OPEN, ContestStatus.ACTIVE],
    });

    expect(pending.map((contest) => contest.id)).toEqual([open.id, live.id]);
  });

  it('finds every league\'s contests in the given statuses, oldest first, with their events', async () => {
    const first = await createLeagueAndEvent();
    const second = await createLeagueAndEvent();
    const open = await createContest(first.league.id, first.event.id, 'Open', ContestStatus.OPEN);
    await createContest(first.league.id, first.event.id, 'Draft', ContestStatus.DRAFT);
    const live = await createContest(second.league.id, second.event.id, 'Live', ContestStatus.ACTIVE);
    await createContest(second.league.id, second.event.id, 'Completed', ContestStatus.COMPLETED);

    const found = await repos().contests.findByStatuses([ContestStatus.OPEN, ContestStatus.ACTIVE]);

    const ours = found.filter((contest) => [first.league.id, second.league.id].includes(contest.leagueId));
    expect(ours.map((contest) => [contest.id, contest.sportEventIds])).toEqual([
      [open.id, [first.event.id]],
      [live.id, [second.event.id]],
    ]);
  });

  it('transitions a contest only from the given statuses: the second run changes nothing and says so', async () => {
    const { league, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'To Start', ContestStatus.OPEN);
    const startsAt = new Date('2026-06-04T12:00:00.000Z');
    const start = { from: [ContestStatus.OPEN], to: ContestStatus.ACTIVE, startsAt };

    await expect(repos().contests.transitionStatus(contest.id, start)).resolves.toBe(true);
    await expect(repos().contests.transitionStatus(contest.id, start)).resolves.toBe(false);
    const started = await repos().contests.findById(contest.id);
    expect(started).toEqual(expect.objectContaining({ status: ContestStatus.ACTIVE, startsAt, endsAt: undefined }));

    const endsAt = new Date('2026-06-07T22:00:00.000Z');
    await expect(repos().contests.transitionStatus(contest.id, {
      from: [ContestStatus.ACTIVE], to: ContestStatus.COMPLETED, endsAt,
    })).resolves.toBe(true);
    const completed = await repos().contests.findById(contest.id);
    expect(completed).toEqual(expect.objectContaining({ status: ContestStatus.COMPLETED, startsAt, endsAt }));
  });

  it('deletes a DRAFT contest whose configuration carries a scoring rule and a prize definition, with everything under it', async () => {
    // Before #247 the delete left the configuration's rules and prizes in place, so the
    // configuration's own delete failed on their foreign keys. #246's backfill gave every golf
    // configuration a rule, which made that every DRAFT golf contest.
    const prisma = getPrisma();
    const { league, squads, event, field } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Draft With Rules', ContestStatus.DRAFT);
    const configuration = await prisma.contestConfiguration.create({
      data: {
        contestId: contest.id,
        selectionType: 'TIERED',
        participantScoringRules: {
          create: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1 },
        },
        prizeDefinitions: {
          create: { prizeDefinitionId: 'WINNER', displayName: 'Winner', sortOrder: 1 },
        },
      },
    });
    const entry = await prisma.contestEntry.create({
      data: { contestId: contest.id, squadId: squads[0].id, entryNumber: 1, name: 'Entry' },
    });
    await prisma.contestEntryPick.create({
      data: { entryId: entry.id, sportEventParticipantId: field[0].id, contestFormat: 'ROSTER', slot: 1 },
    });
    await repos().standings.upsert({
      contestId: contest.id,
      contestEntryId: entry.id,
      position: 1,
      displayPosition: '1',
      countingPickLimit: 1,
      scoredPickCount: 1,
      asOf: null,
      settledAt: new Date(),
      totalScore: -3,
    });

    await repos().contests.delete(contest.id);

    await expect(repos().contests.findById(contest.id)).resolves.toBeNull();
    const remaining = await Promise.all([
      prisma.contestConfiguration.count({ where: { id: configuration.id } }),
      prisma.participantContestScoringRule.count({ where: { contestConfigurationId: configuration.id } }),
      prisma.contestPrizeDefinition.count({ where: { contestConfigurationId: configuration.id } }),
      prisma.contestEntry.count({ where: { contestId: contest.id } }),
      prisma.contestEntryPick.count({ where: { entryId: entry.id } }),
      prisma.contestEntryStanding.count({ where: { contestId: contest.id } }),
    ]);
    expect(remaining).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('updates only the contest fields given and returns the contest with its event\'s sport, as every read does', async () => {
    const { league, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Before', ContestStatus.DRAFT);
    const startsAt = new Date('2026-06-04T12:00:00.000Z');

    const renamed = await repos().contests.update(contest.id, { name: 'After', startsAt });

    expect(renamed).toEqual(expect.objectContaining({
      name: 'After',
      startsAt,
      status: ContestStatus.DRAFT,
      sportEventIds: [event.id],
      sport: Sport.GOLF,
    }));
    await expect(repos().contests.findById(contest.id)).resolves.toEqual(renamed);
  });

  it('creates a contest on several events, reads them back in the given sequence, and finds it from each of its events', async () => {
    const { league, event, suffix } = await createLeagueAndEvent();
    const later = await createLaterEvent(suffix);

    const created = await createContest(league.id, [event.id, later.event.id], 'Two Majors');

    expect(created.sportEventIds).toEqual([event.id, later.event.id]);
    await expect(getPrisma().contestSportEvent.findMany({
      where: { contestId: created.id },
      orderBy: { sequence: 'asc' },
      select: { sportEventId: true, sequence: true },
    })).resolves.toEqual([{ sportEventId: event.id, sequence: 1 }, { sportEventId: later.event.id, sequence: 2 }]);
    expect((await repos().contests.findBySportEvent(event.id)).map((contest) => contest.id)).toEqual([created.id]);
    expect((await repos().contests.findBySportEvent(later.event.id)).map((contest) => contest.id)).toEqual([created.id]);
  });

  it('adds an event to a contest with a DRAFT status for it on every entry, renumbering the sequence by the order given', async () => {
    const { league, squads, event, suffix } = await createLeagueAndEvent();
    const later = await createLaterEvent(suffix);
    const contest = await createContest(league.id, event.id, 'Growing', ContestStatus.OPEN);
    const entry = await createEntry(contest.id, squads[0].id, 1, 'Grower');
    await repos().entries.setEventStatus(entry.id, event.id, 'SUBMITTED', new Date('2026-06-01T12:00:00.000Z'));

    await repos().contests.replaceSportEvents(contest.id, [later.event.id, event.id]);

    expect((await repos().contests.findById(contest.id))?.sportEventIds).toEqual([later.event.id, event.id]);
    const reread = expectDefined(await repos().entries.findByIdWithSquad(entry.id));
    expect(byEvent(reread.events)).toEqual([
      [event.id, 'SUBMITTED'],
      [later.event.id, 'DRAFT'],
    ].sort(([left], [right]) => left.localeCompare(right)));
  });

  it('removes an event from a contest with each entry\'s status and picks in it, keeping the other event\'s', async () => {
    const prisma = getPrisma();
    const { league, squads, event, field, suffix } = await createLeagueAndEvent();
    const later = await createLaterEvent(suffix);
    const contest = await createContest(league.id, [event.id, later.event.id], 'Shrinking', ContestStatus.OPEN);
    const entry = await createEntry(contest.id, squads[0].id, 1, 'Shrinker');
    await prisma.contestEntryPick.createMany({
      data: [
        { entryId: entry.id, sportEventParticipantId: field[0].id, contestFormat: 'ROSTER', slot: 1 },
        { entryId: entry.id, sportEventParticipantId: later.field[0].id, contestFormat: 'ROSTER', slot: 1 },
      ],
    });

    await repos().contests.replaceSportEvents(contest.id, [later.event.id]);

    expect((await repos().contests.findById(contest.id))?.sportEventIds).toEqual([later.event.id]);
    const reread = expectDefined(await repos().entries.findByIdWithSquad(entry.id));
    expect(byEvent(reread.events)).toEqual([[later.event.id, 'DRAFT']]);
    const picks = await repos().picks.findByEntriesWithParticipant([entry.id]);
    expect(picks.map((pick) => [pick.sportEventParticipantId, pick.sportEventId])).toEqual([[later.field[0].id, later.event.id]]);
  });
});

describe('ContestConfigurationRepository', () => {
  it('reads stored rules back typed by selection type, dropping keys the rules do not define', async () => {
    const { league, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Budget rules', ContestStatus.DRAFT);
    await getPrisma().contestConfiguration.create({
      data: {
        contestId: contest.id,
        selectionType: 'BUDGET_PICK',
        configJson: {
          selectionType: SelectionType.BUDGET_PICK,
          rosterSize: 6,
          countedScores: 4,
          salaryCap: 50_000,
          budget: 8_000,
          pickCount: 6,
        },
      },
    });

    const configuration = await new PrismaContestConfigurationRepository(getPrisma()).findByContest(contest.id);

    expect(configuration?.configJson).toEqual({
      selectionType: SelectionType.BUDGET_PICK,
      rosterSize: 6,
      countedScores: 4,
      salaryCap: 50_000,
    });
  });
});

describe('ParticipantContestScoringRuleRepository', () => {
  async function configurationFor(name: string) {
    const { league, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, name, ContestStatus.DRAFT);
    return getPrisma().contestConfiguration.create({ data: { contestId: contest.id, selectionType: 'TIERED' } });
  }

  it('writes a rule\'s typed settings into its config column and reads them back as the definition\'s settings', async () => {
    const configuration = await configurationFor('Typed settings');
    const repo = new PrismaParticipantContestScoringRuleRepository(getPrisma());

    await repo.create({
      contestConfigurationId: configuration.id,
      sortOrder: 1,
      scoring: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: {} },
      active: true,
    });

    const stored = await getPrisma().participantContestScoringRule.findFirstOrThrow({ where: { contestConfigurationId: configuration.id } });
    expect(stored).toMatchObject({ participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: {} });
    await expect(repo.findByContestConfiguration(configuration.id)).resolves.toEqual([
      expect.objectContaining({
        sortOrder: 1,
        active: true,
        scoring: { success: true, data: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: {} } },
      }),
    ]);
  });

  it('reads retired keys out of a stored config, and a retired definition or a non-object config as a failed parse, in sort order', async () => {
    const configuration = await configurationFor('Stored settings');
    await getPrisma().participantContestScoringRule.createMany({
      data: [
        { contestConfigurationId: configuration.id, participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 1, config: { cutRule: { type: 'FIXED_SCORE', fixedScore: 80 } } },
        { contestConfigurationId: configuration.id, participantScoringDefinitionId: 'STABLEFORD_POINTS', sortOrder: 2, config: {} },
        { contestConfigurationId: configuration.id, participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', sortOrder: 3, config: [] },
      ],
    });

    const rules = await new PrismaParticipantContestScoringRuleRepository(getPrisma()).findByContestConfiguration(configuration.id);

    expect(rules.map((rule) => rule.scoring)).toEqual([
      { success: true, data: { participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL', config: {} } },
      { success: false, reason: 'DEFINITION_UNKNOWN', participantScoringDefinitionId: 'STABLEFORD_POINTS' },
      { success: false, reason: 'SETTINGS_INVALID', participantScoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL' },
    ]);
  });
});

describe('ContestConfigTemplateRepository', () => {
  // Golf's reference templates share the sport, so these carry a key prefix of their own: the
  // cleanup removes only them, and each assertion reads only them.
  const prefix = `itest-${randomUUID().slice(0, 8)}-`;
  const ours = <T extends { templateKey: string }>(templates: T[]) =>
    templates.filter((template) => template.templateKey.startsWith(prefix));
  afterEach(async () => {
    await getPrisma().contestConfigTemplate.deleteMany({ where: { templateKey: { startsWith: prefix } } });
  });

  async function createTemplate(key: string, eventType: ContestTemplateEventType | null, sortOrder: number, sportLeagueId: string | null = null) {
    return getPrisma().contestConfigTemplate.create({
      data: {
        sport: Sport.GOLF,
        sportLeagueId,
        eventType,
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        templateKey: `${prefix}${key}`,
        name: `Template ${key}`,
        description: 'Integration template',
        sortOrder,
        configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 1 },
      },
    });
  }

  it("lists an event type's templates with the ones for any event type, in sort order", async () => {
    await createTemplate('any', null, 2);
    await createTemplate('knockout', ContestTemplateEventType.KNOCKOUT, 1);
    await createTemplate('week', ContestTemplateEventType.WEEK, 0);

    const templates = await new PrismaContestConfigTemplateRepository(getPrisma())
      .list({ sport: Sport.GOLF, eventType: ContestTemplateEventType.KNOCKOUT });

    expect(ours(templates).map((template) => template.templateKey)).toEqual([`${prefix}knockout`, `${prefix}any`]);
  });

  /** Two golf sport leagues, a PGA-style and an LPGA-style tour, for league-scoped templates (#624). */
  async function createGolfLeagues() {
    const prisma = getPrisma();
    const sport = await prisma.sport.upsert({
      where: { sport: Sport.GOLF },
      create: { sport: Sport.GOLF, participantType: 'INDIVIDUAL', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
      update: {},
    });
    const suffix = randomUUID().slice(0, 8);
    const [pga, lpga] = await Promise.all([
      prisma.sportLeague.create({ data: { sportId: sport.id, name: `PGA-style ${suffix}` } }),
      prisma.sportLeague.create({ data: { sportId: sport.id, name: `LPGA-style ${suffix}` } }),
    ]);
    return { pga, lpga };
  }

  it("lists a sport league's own templates with the sport-wide ones and never another league's", async () => {
    const { pga, lpga } = await createGolfLeagues();
    await createTemplate('sport-wide', null, 0);
    await createTemplate('lpga', null, 1, lpga.id);
    await createTemplate('pga', null, 2, pga.id);
    const repo = new PrismaContestConfigTemplateRepository(getPrisma());

    const forLpga = await repo.list({ sport: Sport.GOLF, sportLeagueId: lpga.id });
    const unfiltered = await repo.list({ sport: Sport.GOLF });

    expect(ours(forLpga).map((template) => [template.templateKey, template.sportLeagueId])).toEqual([
      [`${prefix}sport-wide`, null],
      [`${prefix}lpga`, lpga.id],
    ]);
    expect(ours(unfiltered).map((template) => template.templateKey)).toEqual([
      `${prefix}sport-wide`, `${prefix}lpga`, `${prefix}pga`,
    ]);
  });

  it('narrows by sport league and event type together: both must match or be unscoped', async () => {
    const { lpga } = await createGolfLeagues();
    await createTemplate('lpga-knockout', ContestTemplateEventType.KNOCKOUT, 0, lpga.id);
    await createTemplate('lpga-week', ContestTemplateEventType.WEEK, 1, lpga.id);
    await createTemplate('any', null, 2);

    const templates = await new PrismaContestConfigTemplateRepository(getPrisma())
      .list({ sport: Sport.GOLF, sportLeagueId: lpga.id, eventType: ContestTemplateEventType.KNOCKOUT });

    expect(ours(templates).map((template) => template.templateKey)).toEqual([`${prefix}lpga-knockout`, `${prefix}any`]);
  });

  it('refuses to delete a sport league that still has a template of its own', async () => {
    const { lpga } = await createGolfLeagues();
    await createTemplate('lpga', null, 0, lpga.id);

    await expect(getPrisma().sportLeague.delete({ where: { id: lpga.id } })).rejects.toThrow();
  });

  it('updates only the fields given, and a retired template leaves the active list', async () => {
    const kept = await createTemplate('kept', null, 0);
    const retired = await createTemplate('retired', null, 1);
    const repo = new PrismaContestConfigTemplateRepository(getPrisma());

    const updated = await repo.update(retired.id, { name: 'Retired Template', active: false });

    expect(updated).toEqual(expect.objectContaining({
      name: 'Retired Template',
      active: false,
      description: 'Integration template',
      sortOrder: 1,
      configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 1 },
    }));
    const active = await repo.list({ sport: Sport.GOLF, active: true });
    expect(ours(active).map((template) => template.id)).toEqual([kept.id]);
  });
});

describe('ContestConfigurationRepository.findByTemplateEventSeries (#714)', () => {
  const prefix = `itest-series-${randomUUID().slice(0, 8)}-`;
  afterEach(async () => {
    await cleanupTestData();
    await getPrisma().contestConfigTemplate.deleteMany({ where: { templateKey: { startsWith: prefix } } });
    await getPrisma().sportLeague.deleteMany({ where: { name: { startsWith: prefix } } });
  });

  async function createSeriesTemplate(key: string, sportLeagueId: string, eventSeriesNames: string[]) {
    return getPrisma().contestConfigTemplate.create({
      data: {
        sport: Sport.GOLF,
        sportLeagueId,
        contestFormat: 'ROSTER',
        selectionType: 'TIERED',
        templateKey: `${prefix}${key}`,
        name: `Series template ${key}`,
        description: 'Integration template',
        sortOrder: 0,
        configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 1 },
        eventSeriesNames,
      },
    });
  }

  async function contestFromTemplate(leagueId: string, sportEventId: string, name: string, templateId: string) {
    const contest = await createContest(leagueId, sportEventId, name, ContestStatus.OPEN);
    return getPrisma().contestConfiguration.create({
      data: {
        contestId: contest.id,
        templateId,
        selectionType: 'TIERED',
        configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 1 },
      },
    });
  }

  it('finds the configurations of contests made from a template naming the series in the series\' own sport league, and no others', async () => {
    const prisma = getPrisma();
    const { league, event } = await createLeagueAndEvent();
    const series = await prisma.eventSeries.findUniqueOrThrow({ where: { id: event.eventSeriesId } });
    const otherTour = await prisma.sportLeague.create({
      data: { sportId: (await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } })).id, name: `${prefix}other tour` },
    });
    const covering = await createSeriesTemplate('covering', series.sportLeagueId, ['Some Other Major', series.name]);
    const otherLeague = await createSeriesTemplate('other-league', otherTour.id, [series.name]);
    const otherSeries = await createSeriesTemplate('other-series', series.sportLeagueId, ['Some Other Major']);
    const expected = await contestFromTemplate(league.id, event.id, 'Covered Pool', covering.id);
    await contestFromTemplate(league.id, event.id, 'Other League Pool', otherLeague.id);
    await contestFromTemplate(league.id, event.id, 'Other Series Pool', otherSeries.id);

    const found = await new PrismaContestConfigurationRepository(prisma).findByTemplateEventSeries(series.id);

    expect(found.map((configuration) => configuration.id)).toEqual([expected.id]);
    await expect(new PrismaContestConfigurationRepository(prisma).findByTemplateEventSeries(randomUUID())).resolves.toEqual([]);
  });
});

describe('ContestEntryRepository', () => {
  it('creates an entry a DRAFT in each of its contest\'s events, with no submit time', async () => {
    const { league, squads, event, suffix } = await createLeagueAndEvent();
    const later = await createLaterEvent(suffix);
    const contest = await createContest(league.id, [event.id, later.event.id], 'Born Drafts', ContestStatus.OPEN);

    const entry = await createEntry(contest.id, squads[0].id, 1, 'Newcomer');

    expect(byEvent(entry.events)).toEqual([[event.id, 'DRAFT'], [later.event.id, 'DRAFT']].sort(([left], [right]) => left.localeCompare(right)));
    expect(entry.events.every((row) => row.submittedAt === undefined)).toBe(true);
  });

  it('submits one event of an entry with its submit time, leaving its other event a draft, and clears the time when it returns to DRAFT', async () => {
    const { league, squads, event, suffix } = await createLeagueAndEvent();
    const later = await createLaterEvent(suffix);
    const contest = await createContest(league.id, [event.id, later.event.id], 'Per Event', ContestStatus.OPEN);
    const entry = await createEntry(contest.id, squads[0].id, 1, 'Submitter');
    const at = new Date('2026-06-02T08:00:00.000Z');

    const submitted = await repos().entries.setEventStatus(entry.id, event.id, 'SUBMITTED', at);

    expect(submitted.events.find((row) => row.sportEventId === event.id)).toEqual({ sportEventId: event.id, status: 'SUBMITTED', submittedAt: at });
    expect(submitted.events.find((row) => row.sportEventId === later.event.id)).toEqual({ sportEventId: later.event.id, status: 'DRAFT', submittedAt: undefined });

    const reverted = await repos().entries.setEventStatus(entry.id, event.id, 'DRAFT', new Date('2026-06-03T08:00:00.000Z'));

    expect(reverted.events.find((row) => row.sportEventId === event.id)).toEqual({ sportEventId: event.id, status: 'DRAFT', submittedAt: undefined });
  });

  it('lists a contest\'s entries by entry number with squad names, optionally only the ones that submitted one event', async () => {
    const { league, squads, event, suffix } = await createLeagueAndEvent();
    const later = await createLaterEvent(suffix);
    const contest = await createContest(league.id, [event.id, later.event.id], 'Entries');
    // Created out of order, so the order below is the adapter's, not insertion order.
    const second = await createEntry(contest.id, squads[1].id, 2, 'Second');
    const first = await createEntry(contest.id, squads[0].id, 1, 'First');
    const draft = await createEntry(contest.id, squads[1].id, 3, 'Draft');
    await repos().entries.setEventStatus(second.id, event.id, 'SUBMITTED', new Date());
    await repos().entries.setEventStatus(first.id, event.id, 'SUBMITTED', new Date());
    await repos().entries.setEventStatus(draft.id, later.event.id, 'SUBMITTED', new Date());

    const all = await repos().entries.findByContestWithSquad(contest.id);
    const submittedFirstEvent = await repos().entries.findByContestWithSquad(contest.id, { submittedFor: event.id });
    const submittedLaterEvent = await repos().entries.findByContestWithSquad(contest.id, { submittedFor: later.event.id });
    const one = await repos().entries.findByIdWithSquad(second.id);

    expect(all.map((entry) => [entry.id, entry.squadName])).toEqual([
      [first.id, `Alpha ${suffix}`],
      [second.id, `Bravo ${suffix}`],
      [draft.id, `Bravo ${suffix}`],
    ]);
    expect(submittedFirstEvent.map((entry) => entry.id)).toEqual([first.id, second.id]);
    expect(submittedLaterEvent.map((entry) => entry.id)).toEqual([draft.id]);
    expect(one).toEqual(expect.objectContaining({ id: second.id, entryNumber: 2, squadName: `Bravo ${suffix}` }));
    await expect(repos().entries.findByIdWithSquad(randomUUID())).resolves.toBeNull();
  });

  it('updates only the entry fields given, leaving the others and its event statuses as stored', async () => {
    const { league, squads, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Entry Update');
    const created = await repos().entries.create({
      contestId: contest.id, squadId: squads[0].id, entryNumber: 1, name: 'Original', tiebreakerValue: 270,
    });
    const entry = created.status === 'created' ? created.entry : null;
    const stored = expectDefined(entry);
    await repos().entries.setEventStatus(stored.id, event.id, 'SUBMITTED', new Date());

    const updated = await repos().entries.update(stored.id, { name: 'Renamed' });

    expect(updated).toEqual(expect.objectContaining({ id: stored.id, name: 'Renamed', tiebreakerValue: 270 }));
    expect(byEvent(updated.events)).toEqual([[event.id, 'SUBMITTED']]);
  });

  it('deletes one entry of an undrawn contest and leaves the contest\'s other entries', async () => {
    const { league, squads, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Entry Delete');
    const leaving = await createEntry(contest.id, squads[0].id, 1, 'Leaving');
    const staying = await createEntry(contest.id, squads[1].id, 1, 'Staying');

    await expect(repos().entries.delete(leaving.id)).resolves.toEqual({ status: 'deleted' });

    expect((await repos().entries.findByContest(contest.id)).map((entry) => entry.id)).toEqual([staying.id]);
    await expect(getPrisma().contestEntryEvent.count({ where: { contestEntryId: leaving.id } })).resolves.toBe(0);
  });
});

describe('StandingsEmailPositionRepository (#877)', () => {
  it('records each entry\'s place in a standings email and reads back only the contest\'s placed entries, the next record replacing the last, without touching the entry\'s update time', async () => {
    const { league, squads, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Standings');
    const other = await createContest(league.id, event.id, 'Other Standings');
    const leader = await createEntry(contest.id, squads[0].id, 1, 'Leader');
    const unscored = await createEntry(contest.id, squads[1].id, 1, 'Unscored');
    const elsewhere = await createEntry(other.id, squads[0].id, 1, 'Elsewhere');
    const positions = new PrismaStandingsEmailPositionRepository(getPrisma());

    await expect(positions.findByContest(contest.id)).resolves.toEqual(new Map());
    await positions.record([
      { contestEntryId: leader.id, position: 1 },
      { contestEntryId: unscored.id, position: null },
      { contestEntryId: elsewhere.id, position: 4 },
    ]);
    await expect(positions.findByContest(contest.id)).resolves.toEqual(new Map([[leader.id, 1]]));

    await positions.record([{ contestEntryId: leader.id, position: 2 }, { contestEntryId: unscored.id, position: 1 }]);
    await expect(positions.findByContest(contest.id)).resolves.toEqual(new Map([[leader.id, 2], [unscored.id, 1]]));
    await expect(positions.findByContest(other.id)).resolves.toEqual(new Map([[elsewhere.id, 4]]));
    await positions.record([]);
    // Entry receipts read the entry's update time; a standings email is not an update to it.
    const stored = await getPrisma().contestEntry.findUniqueOrThrow({ where: { id: leader.id } });
    expect(stored.updatedAt).toEqual(leader.updatedAt);
  });
});

describe('EmailMessageRepository.existsForContest (#877)', () => {
  it('finds a contest\'s email of the template under the key prefix, for anyone and in any state, and nothing for another contest, template or moment', async () => {
    const { league, event, suffix } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Outbox');
    const other = await createContest(league.id, event.id, 'Other Outbox');
    const outbox = new PrismaEmailMessageRepository(getPrisma());
    const about = `${contest.id}:${event.id}:round-1`;
    await outbox.record({
      templateKey: 'CONTEST_STANDINGS',
      contestId: contest.id,
      recipientEmail: `standings-${suffix}@integration.test`,
      idempotencyKey: `CONTEST_STANDINGS:${about}:user-${suffix}`,
      fromName: 'Contest Repo League',
      fromAddress: 'league@integration.test',
      status: 'SKIPPED',
      skipReason: 'OPTED_OUT',
    });
    const exists = (contestId: string, templateKey: 'CONTEST_STANDINGS' | 'CONTEST_OPENED', keyPrefix: string) =>
      outbox.existsForContest({ contestId, templateKey, keyPrefix });

    await expect(exists(contest.id, 'CONTEST_STANDINGS', `CONTEST_STANDINGS:${about}:`)).resolves.toBe(true);
    await expect(exists(contest.id, 'CONTEST_STANDINGS', `CONTEST_STANDINGS:${contest.id}:${event.id}:round-2:`)).resolves.toBe(false);
    await expect(exists(contest.id, 'CONTEST_STANDINGS', `CONTEST_STANDINGS:${contest.id}:${event.id}:round-10:`)).resolves.toBe(false);
    await expect(exists(contest.id, 'CONTEST_OPENED', `CONTEST_OPENED:${about}:`)).resolves.toBe(false);
    await expect(exists(other.id, 'CONTEST_STANDINGS', `CONTEST_STANDINGS:${about}:`)).resolves.toBe(false);
  });
});

describe('ContestEntryPickRepository — read-only', () => {
  it('reads picks in pick order, with their golfer, and counts them per entry', async () => {
    const prisma = getPrisma();
    const { league, squads, event, field, suffix } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Picks');
    const [picked, empty] = await Promise.all([
      prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squads[0].id, entryNumber: 1, name: 'Picked' } }),
      prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squads[1].id, entryNumber: 1, name: 'Empty' } }),
    ]);
    await prisma.sportEventParticipant.update({
      where: { id: field[1].id },
      data: { isActive: false, inactiveReason: 'WITHDRAWN' },
    });
    const later = await prisma.contestEntryPick.create({
      data: {
        entryId: picked.id, sportEventParticipantId: field[1].id, contestFormat: 'ROSTER', slot: 2,
        pickedAt: new Date('2026-06-01T12:05:00.000Z'),
      },
    });
    const earlier = await prisma.contestEntryPick.create({
      data: {
        entryId: picked.id, sportEventParticipantId: field[0].id, contestFormat: 'ROSTER', slot: 1,
        pickedAt: new Date('2026-06-01T12:00:00.000Z'),
      },
    });

    const picks = await repos().picks.findByEntries([picked.id, empty.id]);
    const withParticipant = await repos().picks.findByEntriesWithParticipant([picked.id]);
    const counts = await repos().picks.countByEntries([picked.id, empty.id]);

    expect(picks.map((pick) => [pick.id, pick.slot, pick.contestFormat])).toEqual([
      [earlier.id, 1, 'ROSTER'],
      [later.id, 2, 'ROSTER'],
    ]);
    expect(withParticipant.map((pick) => pick.participant)).toEqual([
      {
        participantId: field[0].participantId,
        participantName: `Golfer One ${suffix}`,
        isActive: true,
        inactiveReason: null,
        role: 'GOLFER',
        teamAffiliation: null,
      },
      {
        participantId: field[1].participantId,
        participantName: `Golfer Two ${suffix}`,
        isActive: false,
        inactiveReason: 'WITHDRAWN',
        role: null,
        teamAffiliation: null,
      },
    ]);
    // Each pick names the event its field row belongs to (#713).
    expect(withParticipant.map((pick) => pick.sportEventId)).toEqual([event.id, event.id]);
    // An entry with no picks is absent from the map, not zero.
    expect(counts).toEqual(new Map([[picked.id, 2]]));
    await expect(repos().picks.findByEntries([])).resolves.toEqual([]);
    await expect(repos().picks.countByEntries([])).resolves.toEqual(new Map());
  });

  it('counts picks across one contest\'s entries, ignoring other contests', async () => {
    const prisma = getPrisma();
    const { league, squads, event, field } = await createLeagueAndEvent();
    const [contest, other] = [
      await createContest(league.id, event.id, 'Counted'),
      await createContest(league.id, event.id, 'Other'),
    ];
    const [alpha, bravo, elsewhere] = await Promise.all([
      prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squads[0].id, entryNumber: 1, name: 'Alpha' } }),
      prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squads[1].id, entryNumber: 1, name: 'Bravo' } }),
      prisma.contestEntry.create({ data: { contestId: other.id, squadId: squads[0].id, entryNumber: 1, name: 'Elsewhere' } }),
    ]);
    const pick = (entryId: string, sportEventParticipantId: string, slot: number, minute: number) => prisma.contestEntryPick.create({
      data: {
        entryId, sportEventParticipantId, contestFormat: 'ROSTER', slot,
        pickedAt: new Date(`2026-06-01T12:0${minute}:00.000Z`),
      },
    });
    await pick(bravo.id, field[0].id, 1, 1);
    await pick(alpha.id, field[0].id, 1, 0);
    await pick(alpha.id, field[1].id, 2, 2);
    await pick(elsewhere.id, field[0].id, 1, 3);

    await expect(repos().picks.countByContest(contest.id)).resolves.toBe(3);
    await expect(repos().picks.countByContest(other.id)).resolves.toBe(1);
  });

  it('has no insert: ContestEntryPickService.createPick stays the single insert path (plans/117 §7.1)', () => {
    const port = repos().picks as unknown as Record<string, unknown>;
    for (const write of ['create', 'createMany', 'upsert', 'update', 'delete']) {
      expect(port[write]).toBeUndefined();
    }
  });
});

describe('ContestEntryStandingRepository', () => {
  it('writes an entry\'s standing with its settled total, overwrites it on the next upsert, and reads unranked entries last', async () => {
    const prisma = getPrisma();
    const { league, squads, event } = await createLeagueAndEvent();
    const contest = await createContest(league.id, event.id, 'Standings');
    const [ranked, unranked] = await Promise.all([
      prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squads[0].id, entryNumber: 1, name: 'Ranked' } }),
      prisma.contestEntry.create({ data: { contestId: contest.id, squadId: squads[1].id, entryNumber: 1, name: 'Unranked' } }),
    ]);
    const settledAt = new Date('2026-06-07T22:00:00.000Z');
    const base = {
      contestId: contest.id,
      countingPickLimit: 2,
      asOf: new Date('2026-06-07T21:00:00.000Z'),
      settledAt,
    };
    await repos().standings.upsert({
      ...base, contestEntryId: unranked.id, position: null, displayPosition: null, scoredPickCount: 0,
      totalScore: null,
    });
    await repos().standings.upsert({
      ...base, contestEntryId: ranked.id, position: 2, displayPosition: '2', scoredPickCount: 2,
      totalScore: -1,
    });
    // A re-settle overwrites the entry's row rather than adding a second one.
    await repos().standings.upsert({
      ...base, contestEntryId: ranked.id, position: 1, displayPosition: '1', scoredPickCount: 2,
      totalScore: -4,
    });

    const standings = await repos().standings.findByContest(contest.id);

    expect(standings.map((standing) => [standing.contestEntryId, standing.position, standing.displayPosition, standing.totalScore]))
      .toEqual([
        [ranked.id, 1, '1', -4],
        [unranked.id, null, null, null],
      ]);
    expect(standings[0]).toEqual(expect.objectContaining({ countingPickLimit: 2, scoredPickCount: 2, settledAt }));
    await expect(prisma.contestEntryStanding.count({ where: { contestId: contest.id } })).resolves.toBe(2);
  });
});

describe('EventLifecycleService — starting an event\'s contests on the ports (#247)', () => {
  it('activates the event\'s OPEN contest once and wishes every active league member good luck, entrant or not (#845)', async () => {
    const prisma = getPrisma();
    const { owner, league, squads, event } = await createLeagueAndEvent();
    const open = await createContest(league.id, event.id, 'Starts With The Event', ContestStatus.OPEN);
    await prisma.contestConfiguration.create({
      data: {
        contestId: open.id,
        selectionType: 'TIERED',
        configJson: { selectionType: SelectionType.TIERED, picksPerTier: 1, countedScores: 4 },
      },
    });
    const draft = await createContest(league.id, event.id, 'Never Opened', ContestStatus.DRAFT);
    const [member, lapsed, onlooker] = await Promise.all([
      createTestUser({ displayName: 'Squad Member' }),
      createTestUser({ displayName: 'Lapsed Member' }),
      createTestUser({ displayName: 'No Entry' }),
    ]);
    await prisma.user.update({ where: { id: lapsed.user.id }, data: { isActive: false } });
    for (const user of [member, lapsed, onlooker]) {
      await prisma.leagueMembership.create({
        data: { leagueId: league.id, userId: user.user.id, role: 'MEMBER', status: 'ACTIVE', joinedAt: new Date() },
      });
    }
    for (const user of [member, lapsed]) {
      await prisma.squadMembership.create({
        data: { squadId: squads[0].id, leagueId: league.id, userId: user.user.id, status: 'ACTIVE', joinedAt: new Date() },
      });
    }
    const alphaEntry = await createEntry(open.id, squads[0].id, 1, 'Alpha Entry');
    await repos().entries.setEventStatus(alphaEntry.id, event.id, 'SUBMITTED', new Date());
    const send = mockFn<MailDeliveryProvider['send']>(async () => ({ provider: 'smtp', messageId: 'mail' }));
    const lifecycle = createEventLifecycleService(prisma, {
      contestStarted: createContestNotices(prisma, {
        email: emailServiceOver({ providerName: 'smtp', send }),
        appBaseUrl: 'https://app.example.test',
        logger: fakeLogger(),
      }),
    });

    await lifecycle.applySportEventStatusTransition({
      sportEventId: event.id, toStatus: 'IN_PROGRESS', actor: { type: 'ROOT_ADMIN' },
    });

    const [started, untouched] = await Promise.all([
      repos().contests.findById(open.id),
      repos().contests.findById(draft.id),
    ]);
    expect(started).toEqual(expect.objectContaining({ status: ContestStatus.ACTIVE, startsAt: event.startDate }));
    expect(untouched?.status).toBe(ContestStatus.DRAFT);
    await deliverQueuedEmail();
    expect(send.mock.calls.map(([message]) => message.to).sort())
      .toEqual([owner.user.email, member.user.email, onlooker.user.email].sort());
    const textTo = (to: string) => send.mock.calls.find(([message]) => message.to === to)?.[0].text ?? '';
    expect(textTo(member.user.email)).toContain('Good luck, everyone.');
    expect(textTo(member.user.email)).toContain('Entries: 1');
    expect(textTo(member.user.email)).toContain(`Leaderboard: https://app.example.test/league/${league.leagueCode}/contests/${open.id}/leaderboard`);
    expect(textTo(member.user.email)).not.toContain('You didn\'t enter this one');
    expect(textTo(onlooker.user.email)).toContain('You didn\'t enter this one');

    // The provider re-sending IN_PROGRESS finds nothing left to start, so nobody is told twice.
    await lifecycle.applySportEventStatusTransition({
      sportEventId: event.id, toStatus: 'IN_PROGRESS', actor: { type: 'SYSTEM' },
    });
    await deliverQueuedEmail();
    expect(send).toHaveBeenCalledTimes(3);
  });
});

describe('Entry reminders on the Prisma adapters (#845)', () => {
  it('reminds the league members with nothing submitted for the event, each once, and skips the one who submitted', async () => {
    const prisma = getPrisma();
    const { owner, league, squads, event } = await createLeagueAndEvent();
    const open = await createContest(league.id, event.id, 'Reminded Pool', ContestStatus.OPEN);
    const [drafting, submitted, removed] = await Promise.all([
      createTestUser({ displayName: 'Drafting Member' }),
      createTestUser({ displayName: 'Submitted Member' }),
      createTestUser({ displayName: 'Removed Member' }),
    ]);
    for (const [user, squad, status] of [[drafting, squads[0], 'ACTIVE'], [submitted, squads[1], 'ACTIVE'], [removed, squads[0], 'INACTIVE']] as const) {
      await prisma.leagueMembership.create({
        data: { leagueId: league.id, userId: user.user.id, role: 'MEMBER', status, joinedAt: new Date() },
      });
      await prisma.squadMembership.create({
        data: { squadId: squad.id, leagueId: league.id, userId: user.user.id, status: 'ACTIVE', joinedAt: new Date() },
      });
    }
    await createEntry(open.id, squads[0].id, 1, 'Alpha Entry');
    const bravoEntry = await createEntry(open.id, squads[1].id, 1, 'Bravo Entry');
    await repos().entries.setEventStatus(bravoEntry.id, event.id, 'SUBMITTED', new Date());
    const send = mockFn<MailDeliveryProvider['send']>(async () => ({ provider: 'smtp', messageId: 'mail' }));
    const reminders = createEntryReminders(prisma, {
      email: emailServiceOver({ providerName: 'smtp', send }),
      readConfig: () => EMAIL_SETTINGS.defaults({ POOLMASTER_ENVIRONMENT: 'prod' }),
      appBaseUrl: 'https://app.example.test',
    });
    const dayBefore = new Date(event.startDate.getTime() - 24 * 60 * 60_000 + 60_000);

    await reminders.queueDue(dayBefore);
    await reminders.queueDue(dayBefore);
    await deliverQueuedEmail();

    // Other suites' contests may be due too; only this league's emails are this test's.
    const ours = send.mock.calls.map(([message]) => message).filter((message) => message.from.name === league.name);
    expect(ours.map((message) => message.to).sort()).toEqual([owner.user.email, drafting.user.email].sort());
    expect(ours.every((message) => message.subject === 'Picks close soon: Reminded Pool')).toBe(true);
    expect(ours.find((message) => message.to === drafting.user.email)?.text).toMatch(/Your .+ entry is (a draft with \d+ of \d+ picked|saved as a draft)\./);
  });
});
