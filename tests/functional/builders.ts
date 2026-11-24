import { createLeague, createSportLeague, listEvents, listPlatformPricingProfiles, listPlatformTierProfiles, loginUser, registerUser } from '@poolmaster/shared/generated/hey-api';
import type { Client } from '@poolmaster/shared/generated/hey-api/client';
import { randomUUID } from 'node:crypto';
import { SPORT_PLATFORM_TIER_PROFILE_CODE, STANDARD_PLATFORM_PRICING_PROFILE_CODE } from '../support/league-profiles';
import { fixtureSeasonId, withCurrentSeason } from '../support/event-edition';
import type { ContestSelectionConfig, SelectionType, Sport } from '@poolmaster/shared/domain';
import {
  createAuthenticatedClient,
  createFunctionalEmail,
  getFunctionalPrisma,
  getSdkClient,
} from './setup';

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
    configJson?: ContestSelectionConfig;
  };
}): Promise<{ contestId: string }> {
  const prisma = getFunctionalPrisma();
  const contest = await prisma.contest.create({
    data: {
      leagueId,
      seasonYear: 2026,
      name: options.name,
      status: options.status ?? 'OPEN',
      contestFormat: 'ROSTER',
      selectionType: options.selectionType,
    },
  });
  await prisma.contestConfiguration.create({
    data: {
      contestId: contest.id,
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
  const sequence = (await prisma.contestSportEvent.count({ where: { contestId } })) + 1;
  await prisma.contestSportEvent.create({ data: { contestId, sportEventId, sequence } });
  const entries = await prisma.contestEntry.findMany({ where: { contestId }, select: { id: true } });
  await prisma.contestEntryEvent.createMany({
    data: entries.map((entry) => ({ contestEntryId: entry.id, sportEventId })),
    skipDuplicates: true,
  });
}

/**
 * The profile ids a functional test's new sport league names (#1844), read through the API as an
 * admin would: its sport's tier layout (`SPORT_PLATFORM_TIER_PROFILE_CODE`) and Standard pricing.
 */
export async function sportLeagueProfiles(client: Client, sport: Sport): Promise<{ platformTierProfileId: string; platformPricingProfileId: string }> {
  const [tiers, prices] = await Promise.all([listPlatformTierProfiles({ client }), listPlatformPricingProfiles({ client })]);
  const platformTierProfile = tiers.data?.platformTierProfiles.find((profile) => profile.code === SPORT_PLATFORM_TIER_PROFILE_CODE[sport]);
  const platformPricingProfile = prices.data?.platformPricingProfiles.find((profile) => profile.code === STANDARD_PLATFORM_PRICING_PROFILE_CODE);
  if (!platformTierProfile || !platformPricingProfile) {
    throw new Error(`The ${SPORT_PLATFORM_TIER_PROFILE_CODE[sport]} tier profile or the Standard pricing profile is missing.`);
  }
  return { platformTierProfileId: platformTierProfile.id, platformPricingProfileId: platformPricingProfile.id };
}

/**
 * A run's own sport league, standing in for one a migration adds: a test data file loads into a
 * league the site has and never creates one, so a suite that loads a file under a tagged league
 * name adds that league first. Returns its id.
 */
export async function addRunSportLeague(client: Client, sport: Sport, name: string): Promise<string> {
  const created = await createSportLeague({ client, body: { ...(await sportLeagueProfiles(client, sport)), timeZone: 'UTC', sport, name } });
  if (!created.data) {
    throw new Error(`Could not add the sport league ${name}: ${JSON.stringify(created.error)}`);
  }
  // A migration adds a league with its Seasons; this year's stands in for them, made current.
  await withCurrentSeason(getFunctionalPrisma(), created.data.sportLeague.id);
  return created.data.sportLeague.id;
}

/**
 * Makes `championshipYear`'s Season the league's current one, for a test that creates events
 * through the API in that year: a new event goes in its league's current Season (#2003), which
 * the daily recompute sets on a real site. Functional suites run one at a time, so moving a shared
 * league's current Season reaches no other test. Returns the league id.
 */
export async function inCurrentSeason(sportLeagueId: string, championshipYear: number): Promise<string> {
  await withCurrentSeason(getFunctionalPrisma(), sportLeagueId, championshipYear);
  return sportLeagueId;
}

/** The events of the league's Season named for `championshipYear`, as an admin lists one Season (#2003). */
export async function seasonEvents(client: Client, sportLeagueId: string, championshipYear: number) {
  const sportLeagueSeasonId = await fixtureSeasonId(getFunctionalPrisma(), sportLeagueId, championshipYear);
  const listed = await listEvents({ client, query: { sportLeagueSeasonId } });
  if (!listed.data) throw new Error(`Could not list the Season's events: ${JSON.stringify(listed.error)}`);
  return listed.data.events;
}
