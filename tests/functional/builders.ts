import { createEvent, createLeague, createTestSlot, listEvents, loginUser, registerUser } from '@poolmaster/shared/generated/hey-api';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import { randomUUID } from 'node:crypto';
import { fixtureSeasonId, keyedSlotDefinitionId, withCurrentSeason, type TestRoundSlot } from '../support/event-edition';
import { seasonCompetitionFor } from '../support/competitions';
import { contestOnEvents, fixtureTemplateId, placeEventForTemplate } from '../support/contest-rows';
import { testSlotDefinitionId, uniqueTestSlotLabel } from '../support/test-slots';
import { TemplateCoverageMode, type ContestRules, type SelectionType, type Sport } from '@poolmaster/shared/domain';
import {
  createAuthenticatedClient,
  createFunctionalEmail,
  getFunctionalPrisma,
  getSdkClient,
} from './setup';
import { insertTestSportLeague } from '../support/test-sport-league';

function describeSdkFailure(result: {
  response?: Response | undefined;
  error?: unknown;
}): string {
  const status = result.response?.status;
  const payload = result.error;
  const details = payload ? JSON.stringify(payload) : 'no error payload';
  return `status=${status ?? 'unknown'} payload=${details}`;
}

export interface RegisteredUserContext {
  client: Client;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  username: string;
  login: {
    tokens: {
      accessToken: string;
      refreshToken: string;
      csrfToken: string;
      expiresIn: number;
    };
    user: {
      id: string;
      email: string;
      username: string;
      firstName: string;
      lastName: string;
    };
  };
  password: string;
  registration: {
    tokens: {
      accessToken: string;
      refreshToken: string;
      csrfToken: string;
      expiresIn: number;
    };
    user: {
      id: string;
      email: string;
      username: string;
      firstName: string;
      lastName: string;
    };
  };
  token: string;
  userId: string;
}

export async function buildRegisteredUser(overrides?: {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email?: string;
  username?: string;
  password?: string;
}): Promise<RegisteredUserContext> {
  const email = overrides?.email ?? createFunctionalEmail('auth');
  const username = overrides?.username ?? email;
  const password = overrides?.password ?? 'FuncTest123!';
  const fallbackName = overrides?.displayName ?? 'Functional Pilot User';
  const [fallbackFirstName = 'Functional', ...fallbackLastParts] = fallbackName.split(/\s+/);
  const firstName = overrides?.firstName ?? fallbackFirstName;
  const lastName = overrides?.lastName ?? (fallbackLastParts.join(' ').trim() || 'User');
  const displayName = `${firstName} ${lastName}`;

  const registration = await registerUser({
    client: getSdkClient(),
    body: {
      username,
      email,
      password,
      firstName,
      lastName,
    },
  });

  if (!registration.data) {
    throw new Error(`Builder: registerUser failed for ${email} (${describeSdkFailure(registration)})`);
  }

  const login = await loginUser({
    client: getSdkClient(),
    body: {
      identifier: username,
      password,
    },
  });

  if (!login.data) {
    throw new Error(`Builder: loginUser failed for ${email} (${describeSdkFailure(login)})`);
  }

  const token = login.data.tokens.accessToken;
  const client = createAuthenticatedClient(token);

  return {
    client,
    firstName,
    lastName,
    displayName,
    email,
    username,
    login: login.data,
    password,
    registration: registration.data,
    token,
    userId: registration.data.user.id,
  };
}

/**
 * Promotes a user to root admin **and re-issues their session** (#213).
 *
 * Root-admin authority is read from the access-token claim on every surface now (access rule
 * A10), so writing `isRootAdmin: true` straight to the database does not affect a token already
 * in hand. Four suites had their own version of this; three of them promoted without the
 * re-login and only passed because `/admin/*` still re-read the user row. One rule, one place.
 *
 * Mutates the context in place, so callers keep using the same object.
 */
export async function promoteToRootAdmin(user: RegisteredUserContext): Promise<void> {
  await getFunctionalPrisma().user.update({
    where: { id: user.userId },
    data: { isRootAdmin: true },
  });

  const login = await loginUser({
    client: getSdkClient(),
    body: { identifier: user.username, password: user.password },
  });

  const token = login.data?.tokens.accessToken;
  if (!token) {
    throw new Error(
      `Builder: could not re-issue a session after promoting ${user.userId} (${describeSdkFailure(login)})`,
    );
  }

  user.token = token;
  user.client = createAuthenticatedClient(token);
}

export async function buildLeagueWithCommissioner(overrides?: {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email?: string;
  username?: string;
  leagueName?: string;
  password?: string;
}): Promise<{
  league: {
    id: string;
    leagueCode: string;
    name: string;
    memberCount: number;
    activeContestCount: number;
    isActive: boolean;
    iconKey: string;
    createdAt?: string;
    description?: string | null;
    role?: string;
  };
  commissioner: RegisteredUserContext;
  commissionerClient: Client;
}> {
  const commissioner = await buildRegisteredUser({
    firstName: overrides?.firstName,
    lastName: overrides?.lastName,
    displayName: overrides?.displayName,
    email: overrides?.email,
    username: overrides?.username,
    password: overrides?.password,
  });

  const leagueResponse = await createLeague({
    client: commissioner.client,
    body: {
      name: overrides?.leagueName ?? 'Functional Pilot League',
      leagueCode: `FUNC${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`,
    },
  });

  if (!leagueResponse.data) {
    throw new Error(
      `Builder: createLeague failed for commissioner ${commissioner.userId} `
      + `(${describeSdkFailure(leagueResponse)})`,
    );
  }

  return {
    league: leagueResponse.data.league,
    commissioner,
    commissionerClient: commissioner.client,
  };
}

/**
 * A contest row with no sporting event, written straight to the database. #245 retired the
 * event-less create that used to make these through the API; the one create now needs a
 * contest-ready event. Tests whose subject is entries, visibility or selection state rather
 * than creation — and contests on no event, such as these budget and snake ones — seed the rows create and "Open to league" leave behind: an OPEN contest members can
 * see and enter, and a configuration defaulting to one entry per team. `status: 'DRAFT'` seeds
 * the commissioner-only draft create itself writes (#117).
 */
/**
 * The template a functional contest is created from (#2014: every contest is made from one and
 * covers a slot it lists): the first event's league's default of the selection type. A run's own
 * test league has none, so it gets a copy of a seeded league's, of its sport where one has the
 * type, as the migration that adds a league seeds them (`placeEventsForTemplate` then fits it).
 */
export async function contestTemplateFor(sportEventIds: readonly string[], selectionType: SelectionType): Promise<string> {
  const prisma = getFunctionalPrisma();
  // poolmaster-allow-position: the template is the first event's league's; the rest share it
  const firstId = sportEventIds.at(0);
  if (firstId === undefined) throw new Error('fixture: a contest template needs an event');
  const first = await prisma.sportEvent.findUniqueOrThrow({ where: { id: firstId }, select: { sportLeagueId: true, sportLeague: { select: { sportId: true } } } });
  const order = [{ isDefault: 'desc' as const }, { sortOrder: 'asc' as const }, { id: 'asc' as const }];
  const own = await prisma.contestConfigTemplate.findFirst({ where: { sportLeagueId: first.sportLeagueId, selectionType, active: true }, orderBy: order, select: { id: true } });
  if (own !== null) return placedTemplate(sportEventIds, own.id);
  const seeded = { selectionType, active: true, sportLeague: { displayOrder: { not: null } } };
  const { configJson, ...source } = await prisma.contestConfigTemplate.findFirst({ where: { ...seeded, sportLeague: { ...seeded.sportLeague, sportId: first.sportLeague.sportId } }, orderBy: order })
    ?? await prisma.contestConfigTemplate.findFirstOrThrow({ where: seeded, orderBy: order });
  // The copy is a new row of the event's league: its own id and timestamps, and no slots yet. One
  // over several events covers each one's listed slot.
  const copy = await prisma.contestConfigTemplate.create({
    data: {
      ...source, id: undefined, createdAt: undefined, updatedAt: undefined, configJson: configJson ?? {}, sportLeagueId: first.sportLeagueId,
      ...(sportEventIds.length > 1 && { coverageMode: TemplateCoverageMode.ALL_LISTED }),
    },
    select: { id: true },
  });
  return placedTemplate(sportEventIds, copy.id);
}

/**
 * Fits the template to the events for a contest made from it (#2014): a template listing no slot
 * (a run's copy of a league's setups) lists the events' slot definitions, and each event is put
 * in a slot the template lists unless it holds one (`placeEventForTemplate`).
 */
export async function placeEventsForTemplate(sportEventIds: readonly string[], templateId: string): Promise<void> {
  const prisma = getFunctionalPrisma();
  const template = await prisma.contestConfigTemplate.findUniqueOrThrow({ where: { id: templateId }, select: { sportLeagueId: true, slots: { select: { id: true } } } });
  if (template.slots.length === 0) {
    const slots = await prisma.sportEventSlot.findMany({ where: { sportEventId: { in: [...sportEventIds] } }, select: { seasonSlot: { select: { sportLeagueCompetitionSlotId: true } } } });
    const definitionIds = new Set(slots.map((slot) => slot.seasonSlot.sportLeagueCompetitionSlotId));
    await prisma.contestConfigTemplateSlot.createMany({
      data: [...definitionIds].map((sportLeagueCompetitionSlotId) => ({ sportLeagueId: template.sportLeagueId, templateId, sportLeagueCompetitionSlotId })),
    });
  }
  for (const sportEventId of sportEventIds) {
    // poolmaster-allow-query-in-loop: a fixture's few events
    await placeEventForTemplate(prisma, sportEventId, templateId);
  }
}

/** The template, once fitted to the events (`placeEventsForTemplate`). */
export async function placedTemplate<Id extends string | undefined>(sportEventIds: readonly string[], templateId: Id): Promise<Id> {
  if (templateId !== undefined) await placeEventsForTemplate(sportEventIds, templateId);
  return templateId;
}

export async function seedContestFixture(leagueId: string, options: {
  name: string;
  selectionType: SelectionType;
  status?: 'DRAFT' | 'OPEN';
  configuration?: {
    maxEntriesPerSquad?: number;
    /**
     * The contest's typed rules (#479, #93). The selection room reads the roster from here:
     * without them a room has a roster of 0 and refuses every pick as unconfigured.
     */
    configJson?: ContestRules;
  };
}): Promise<{ contestId: string }> {
  const prisma = getFunctionalPrisma();
  // A contest is in a Season (#2014); one seeded before its event takes the event's when it is
  // attached (`attachContestEvent`), so any 2026 Season holds it meanwhile.
  const season = await prisma.sportLeagueSeason.findFirstOrThrow({ where: { championshipYear: 2026 }, orderBy: { id: 'asc' }, select: { id: true, sportLeagueId: true } });
  const contest = await prisma.contest.create({
    data: {
      leagueId,
      sportLeagueSeasonId: season.id,
      name: options.name,
      status: options.status ?? 'OPEN',
      contestFormat: 'ROSTER',
      selectionType: options.selectionType,
    },
  });
  await prisma.contestConfiguration.create({
    data: {
      contestId: contest.id,
      templateId: await fixtureTemplateId(prisma, { sportLeagueId: season.sportLeagueId, selectionType: options.selectionType }),
      selectionType: options.selectionType,
      maxEntriesPerSquad: 1,
      ...options.configuration,
    },
  });
  return { contestId: contest.id };
}

/**
 * Adds `sportEventId` to the end of a seeded contest's events (#713), as "Events in this
 * contest" does: every entry the contest already has gets a DRAFT status in the new event.
 * Fixtures that enter a contest before it has an event, so the entry does not wait on a loaded
 * field, attach the event with this afterwards.
 */
export async function attachContestEvent(contestId: string, sportEventId: string): Promise<void> {
  const prisma = getFunctionalPrisma();
  const { sportLeagueSeasonId, seasonSlots } = await contestOnEvents(prisma, [sportEventId]);
  // A contest seeded with no event takes its first event's Season (#2014).
  if (await prisma.contestSeasonSlot.count({ where: { contestId } }) === 0) {
    await prisma.contest.update({ where: { id: contestId }, data: { sportLeagueSeasonId } });
  }
  await prisma.contestSeasonSlot.createMany({
    data: seasonSlots.create.map((slot) => ({ contestId, sportLeagueSeasonId, ...slot })),
  });
  const entries = await prisma.contestEntry.findMany({ where: { contestId }, select: { id: true } });
  await prisma.contestEntryEvent.createMany({
    data: entries.map((entry) => ({ contestEntryId: entry.id, sportEventId })),
    skipDuplicates: true,
  });
}

/**
 * A run's own sport league, standing in for one a migration adds: a test data file loads into a
 * league the site has and never creates one, so a suite that loads a file under a tagged league
 * name adds that league first, playing as its sport's leagues do. Returns its id.
 */
export async function addRunSportLeague(sport: Sport, name: string): Promise<string> {
  // A migration adds a league with its Seasons and slot definitions; this year's Season stands in
  // for them, made current, with one definition (TEST_EVENT) a test slot can play.
  const { id } = await insertTestSportLeague(getFunctionalPrisma(), { sport, name });
  const seasonId = await withCurrentSeason(getFunctionalPrisma(), id);
  await testSlotDefinitionId(getFunctionalPrisma(), id, seasonId);
  return id;
}

/**
 * Makes `championshipYear`'s Season the league's current one, for a test that creates events
 * through the API in that year: a new event goes in its league's current Season (#2003), which
 * the daily recompute sets on a real site. Functional suites run one at a time, so moving a shared
 * league's current Season reaches no other test. Returns the league id.
 */
export async function inCurrentSeason(sportLeagueId: string, championshipYear: number): Promise<string> {
  const seasonId = await withCurrentSeason(getFunctionalPrisma(), sportLeagueId, championshipYear);
  await testSlotDefinitionId(getFunctionalPrisma(), sportLeagueId, seasonId);
  return sportLeagueId;
}

/** What a test makes a test event with: its league and Season year, and the slot's dates. */
export interface TestEventBody {
  sportLeagueId: string;
  /** The Season it is made in, made the league's current one (`inCurrentSeason`). */
  championshipYear: number;
  name: string;
  venue?: string;
  location?: string;
  startDate: string;
  endDate?: string;
  /** How many rounds the event plays in its one slot (#2008); one unless given. */
  rounds?: number;
  /**
   * One test slot per round (#2006), of a postseason definition made on first use, round 1 first
   * and a day apart from `startDate`: a bracket whose rounds are named, reseeded or finished by
   * their slots. Leaves `rounds` to the slots.
   */
  roundSlots?: readonly TestRoundSlot[];
  autoLifecycleEnabled?: boolean;
}

/**
 * A test event through the API as QA makes one (#2004): a labelled test slot in the league's
 * current Season (`createTestSlot`), then the event on it (`createEvent`), with its `rounds`.
 * Answers the create's result.
 */
export async function createTestEvent({ client, body }: { client: Client; body: TestEventBody }) {
  const { sportLeagueId, championshipYear, startDate, endDate, rounds, roundSlots, ...event } = body;
  const sportLeagueSeasonId = await withCurrentSeason(getFunctionalPrisma(), sportLeagueId, championshipYear);
  if (roundSlots !== undefined) {
    const seasonSlotIds = await testRoundSlotIds(client, { sportLeagueId, startDate }, roundSlots);
    return createEvent({ client, body: { ...event, seasonSlotIds } });
  }
  const slotDefinitionId = await testSlotDefinitionId(getFunctionalPrisma(), sportLeagueId, sportLeagueSeasonId);
  const slot = await createTestSlot({
    client,
    path: { sportLeagueId },
    body: { slotDefinitionId, label: uniqueTestSlotLabel(), startsAt: startDate, ...(endDate !== undefined && { endsAt: endDate }) },
  });
  if (!slot.data) throw new Error(`Could not add a test slot: ${JSON.stringify(slot.error)}`);
  return createEvent({ client, body: { ...event, seasonSlotIds: [slot.data.slot.id], ...(rounds !== undefined && { rounds }) } });
}

/**
 * A postseason slot definition per round (#2006), keyed by its `key` or kind and made on first
 * use, with its competition in the league's current Season so a test slot can play it, as a
 * migration gives a league with a bracket. Answers each round's definition id, round 1 first.
 */
export async function roundSlotDefinitionIds(sportLeagueId: string, roundSlots: readonly TestRoundSlot[]): Promise<string[]> {
  const prisma = getFunctionalPrisma();
  const { currentSeasonId } = await prisma.sportLeague.findUniqueOrThrow({ where: { id: sportLeagueId }, select: { currentSeasonId: true } });
  if (currentSeasonId === null) throw new Error(`Sport league ${sportLeagueId} has no current Season for its round slots.`);
  const ids: string[] = [];
  for (const roundSlot of roundSlots) {
    const slotDefinitionId = await keyedSlotDefinitionId(prisma, sportLeagueId, roundSlot.key ?? roundSlot.slotKind, { phase: 'POSTSEASON', ...roundSlot });
    const definition = await prisma.sportLeagueCompetitionSlot.findUniqueOrThrow({
      where: { id: slotDefinitionId },
      select: { sportLeagueCompetitionId: true, competition: { select: { sportLeaguePhaseId: true } } },
    });
    await seasonCompetitionFor(prisma, {
      sportLeagueId,
      sportLeagueSeasonId: currentSeasonId,
      competition: { competitionId: definition.sportLeagueCompetitionId, phaseId: definition.competition.sportLeaguePhaseId },
    });
    ids.push(slotDefinitionId);
  }
  return ids;
}

/** A test slot per round through the API, a day apart from `startDate`, round 1 first. */
async function testRoundSlotIds(client: Client, where: { sportLeagueId: string; startDate: string }, roundSlots: readonly TestRoundSlot[]): Promise<string[]> {
  const ids: string[] = [];
  for (const [index, slotDefinitionId] of (await roundSlotDefinitionIds(where.sportLeagueId, roundSlots)).entries()) {
    const startsAt = new Date(new Date(where.startDate).getTime() + index * 24 * 60 * 60 * 1000).toISOString();
    const slot = await createTestSlot({ client, path: { sportLeagueId: where.sportLeagueId }, body: { slotDefinitionId, label: uniqueTestSlotLabel(), startsAt } });
    if (!slot.data) throw new Error(`Could not add round ${index + 1}'s test slot: ${JSON.stringify(slot.error)}`);
    ids.push(slot.data.slot.id);
  }
  return ids;
}

/** The events of the league's Season named for `championshipYear`, as an admin lists one Season (#2003). */
export async function seasonEvents(client: Client, sportLeagueId: string, championshipYear: number) {
  const sportLeagueSeasonId = await fixtureSeasonId(getFunctionalPrisma(), sportLeagueId, championshipYear);
  const listed = await listEvents({ client, query: { sportLeagueSeasonId } });
  if (!listed.data) throw new Error(`Could not list the Season's events: ${JSON.stringify(listed.error)}`);
  return listed.data.events;
}
