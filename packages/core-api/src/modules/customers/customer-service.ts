/**
 * Customers (#1882): the root admin's grids of every league and every user on the platform.
 * Nothing pages or searches them on the server: each grid loads every row and filters on the
 * client (Derek, 2026-11-18). Each read is a fixed number of grouped queries, so it costs the same
 * for ten rows as for ten thousand.
 *
 * Editing goes through the routes that already own each write: a league's plan and its gifted
 * plan's end (`/leagues/:id/plan`, `/leagues/:id/plan-renewal/extend`), a user's name, role and
 * account actions (`/users/:userId/...`).
 */
import type { FastifyBaseLogger } from 'fastify';
import type { CustomerLeagueCommissioner, CustomerLeagueFacts, CustomerReader } from '@poolmaster/shared/db';
import type { CustomerLeague, CustomerLeagueOwner, CustomerUser } from '@poolmaster/shared/domain';

export class CustomerService {
  constructor(private readonly deps: {
    reader: CustomerReader;
    logger?: FastifyBaseLogger;
    now?: () => Date;
  }) {}

  /** Every league, by name, each with its owner, counts and Premium preview end. */
  async listLeagues(): Promise<CustomerLeague[]> {
    const facts = await this.deps.reader.readLeagueFacts();
    const leagues = customerLeagues(facts, this.deps.now?.() ?? new Date());
    this.deps.logger?.info({ action: 'customers.leagues.success', data: { leagueCount: leagues.length } }, 'Listed every league for Customers');
    return leagues;
  }

  /** Every user, by last then first name, each with the leagues they belong to. */
  async listUsers(): Promise<CustomerUser[]> {
    const users = await this.deps.reader.readUsers();
    this.deps.logger?.info({ action: 'customers.users.success', data: { userCount: users.length } }, 'Listed every user for Customers');
    return users;
  }
}

/** The Leagues grid's rows from what the reader found, in the reader's order. */
export function customerLeagues(facts: CustomerLeagueFacts, now: Date): CustomerLeague[] {
  const ownerByLeague = longestServingCommissioners(facts.commissioners);
  return facts.leagues.map((league) => ({
    id: league.id,
    leagueCode: league.leagueCode,
    name: league.name,
    isActive: league.isActive,
    plan: league.plan,
    owner: ownerByLeague.get(league.id) ?? null,
    memberCount: facts.memberCounts.get(league.id) ?? 0,
    activeContestCount: facts.activeContestCounts.get(league.id) ?? 0,
    previewEndsAt: league.planRenewsAt > now ? league.planRenewsAt : null,
    createdAt: league.createdAt,
  }));
}

/**
 * Each league's earliest-joined active commissioner: the one who created it, unless they stepped
 * down. Two who joined at the same instant are told apart by user id, so the owner never flips.
 */
function longestServingCommissioners(commissioners: readonly CustomerLeagueCommissioner[]): Map<string, CustomerLeagueOwner> {
  const earliest = new Map<string, CustomerLeagueCommissioner>();
  for (const commissioner of commissioners) {
    const current = earliest.get(commissioner.leagueId);
    if (current === undefined || servedLonger(commissioner, current)) {
      earliest.set(commissioner.leagueId, commissioner);
    }
  }
  return new Map([...earliest].map(([leagueId, { userId, firstName, lastName }]) => [leagueId, { userId, firstName, lastName }]));
}

function servedLonger(candidate: CustomerLeagueCommissioner, current: CustomerLeagueCommissioner): boolean {
  const byJoin = candidate.joinedAt.getTime() - current.joinedAt.getTime();
  return byJoin !== 0 ? byJoin < 0 : candidate.userId < current.userId;
}
