import type { FastifyBaseLogger } from 'fastify';
import type {
  LeagueMembershipRepository,
  SquadMembershipRepository,
  SquadRepository,
} from '@poolmaster/shared/db';
import { LeagueMembershipStatus, LeagueRole } from '@poolmaster/shared/domain';
import { deactivateSquadMembershipForLeagueMember } from '../squads/owner-membership';

interface InactivateLeagueMemberUnitInput {
  leagueId: string;
  userId: string;
  membershipRepo: LeagueMembershipRepository;
  squadRepo?: SquadRepository;
  squadMembershipRepo?: SquadMembershipRepository;
  logger?: FastifyBaseLogger;
}

/**
 * Ends a user's membership of a league, and their squad membership within it.
 *
 * **It does not touch the user's account (#218).** This used to check whether the league being
 * left was the user's last one and, if so, set `user.isActive = false` and revoke every refresh
 * token they held. That let a *relationship* ending mutate the *object's* lifecycle, which is the
 * category error this epic exists to undo — and it made the intended recovery path impossible:
 * `login` refuses an inactive account, accepting an invitation requires a session, and only a
 * root admin can re-enable, so a member removed from their only league was locked out and could
 * not be re-invited.
 *
 * Account state belongs to the user (self-service disable) and to a root admin. A commissioner
 * manages league and squad membership and has no business deciding whether someone can sign in.
 * A user with no leagues signs in fine and lands on the welcome page's empty state.
 */
export async function inactivateLeagueMemberUnit(
  input: InactivateLeagueMemberUnitInput,
): Promise<void> {
  input.logger?.debug({
    action: 'leagueMemberLifecycle.inactivate.enter',
    data: { leagueId: input.leagueId, userId: input.userId },
  }, 'Inactivating league member unit');
  const membership = await input.membershipRepo.findByLeagueAndUser(input.leagueId, input.userId);
  if (!membership || membership.status !== LeagueMembershipStatus.ACTIVE) {
    input.logger?.warn({
      action: 'leagueMemberLifecycle.inactivate.skipped',
      data: {
        leagueId: input.leagueId,
        userId: input.userId,
        reason: membership ? `status:${membership.status}` : 'membership_missing',
      },
    }, 'Skipped league member inactivation');
    return;
  }

  await input.membershipRepo.update(membership.id, {
    status: LeagueMembershipStatus.INACTIVE,
  });

  if (input.squadRepo && input.squadMembershipRepo) {
    await deactivateSquadMembershipForLeagueMember({
      leagueId: input.leagueId,
      userId: input.userId,
      squadRepo: input.squadRepo,
      squadMembershipRepo: input.squadMembershipRepo,
      logger: input.logger,
    });
  }

  input.logger?.info({
    action: 'leagueMemberLifecycle.inactivate.success',
    data: { leagueId: input.leagueId, userId: input.userId },
  }, 'Ended league and squad membership');
}

/**
 * Refuses an operation that would leave a league with no active commissioner (#218).
 *
 * Shared because two operations can now end a league membership: a commissioner removing a
 * member outright, and an owner or commissioner removing a squad co-owner — and a co-owner can
 * be the league's last commissioner, sitting on somebody else's squad. One rule, one place.
 */
export async function requireAnotherActiveCommissioner(input: {
  leagueId: string;
  targetUserId: string;
  membershipRepo: LeagueMembershipRepository;
  logger?: FastifyBaseLogger;
}): Promise<void> {
  const memberships = await input.membershipRepo.findByLeague(input.leagueId);
  const remaining = memberships.filter(
    (membership) =>
      membership.status === LeagueMembershipStatus.ACTIVE &&
      membership.role === LeagueRole.COMMISSIONER &&
      membership.userId !== input.targetUserId,
  );

  if (remaining.length === 0) {
    input.logger?.warn({
      action: 'leagueMemberLifecycle.ensureCommissioner.missingReplacement',
      data: { leagueId: input.leagueId, targetUserId: input.targetUserId },
    }, 'Rejected operation because it would remove the last active commissioner');
    throw new LastCommissionerError();
  }
}

/** Thrown when an operation would leave a league with no active commissioner. */
export class LastCommissionerError extends Error {
  readonly code = 'LEAGUE_LAST_COMMISSIONER_REQUIRED';

  constructor() {
    super('Appoint another active commissioner before removing or demoting the last commissioner.');
    this.name = 'LastCommissionerError';
  }
}
