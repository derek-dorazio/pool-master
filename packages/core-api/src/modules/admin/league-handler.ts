import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AdminLeagueService } from './league-service';
import { LeagueNotFoundError, LeagueOperationError } from './league-service';
import { sendError } from '../../core/error-handler';
import { extractRootAdminContext } from './request-admin-context';
import type { LeagueMembershipRepository, UserRepository } from '@poolmaster/shared/db';
import { mapLeagueMembershipToDto } from '../../mappers/leagues-extra.mapper';

export function createLeagueAdminHandlers(
  adminLeagueService: AdminLeagueService,
  membershipRepo: LeagueMembershipRepository,
  userRepo: UserRepository,
) {
  return {
    listLeagues,
    inactivateLeague,
    deleteLeague,
  };

  async function listLeagues(
    request: FastifyRequest<{
      Querystring: {
        search?: string;
        isActive?: boolean;
      };
    }>,
    _reply: FastifyReply,
  ) {
    const { rootAdminUserId } = extractRootAdminContext(request);
    const leagues = await adminLeagueService.searchLeagues({
      search: request.query.search,
      isActive: request.query.isActive,
    });

    // #202 step 3.4 — `memberships` means "the viewer's own memberships among these
    // leagues" (A8's one exception, the multi-league surface). For a root admin listing
    // leagues they do not belong to it is legitimately empty; it is COMPUTED rather than
    // sent as `[]`, because inventing a value for a viewer field is the exact mistake this
    // step removed from `searchLeagues` — it used to hard-code `isRootAdmin: true` and an
    // all-false relationship on every row.
    const leagueIds = new Set(leagues.map((league) => league.id));
    const [ownMemberships, viewer] = await Promise.all([
      membershipRepo.findByUser(rootAdminUserId),
      userRepo.findById(rootAdminUserId),
    ]);

    return {
      leagues,
      memberships: viewer
        ? ownMemberships
          .filter((membership) => leagueIds.has(membership.leagueId))
          .map((membership) => mapLeagueMembershipToDto(membership, viewer))
        : [],
    };
  }

  async function inactivateLeague(
    request: FastifyRequest<{ Params: { leagueId: string } }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);

    try {
      const league = await adminLeagueService.inactivateLeague(
        request.params.leagueId,
        rootAdminUserId,
        rootAdminEmail,
      );
      return reply.send({ league });
    } catch (err) {
      if (err instanceof LeagueNotFoundError) {
        return sendError(reply, 404, 'LEAGUE_NOT_FOUND', err.message);
      }

      if (err instanceof LeagueOperationError) {
        return sendError(reply, err.statusCode, err.code, err.message);
      }

      throw err;
    }
  }

  async function deleteLeague(
    request: FastifyRequest<{
      Params: { leagueId: string };
      Body: { leagueCode: string };
    }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);

    try {
      await adminLeagueService.deleteLeague(
        request.params.leagueId,
        request.body.leagueCode,
        rootAdminUserId,
        rootAdminEmail,
      );
      return reply.send({ success: true as const });
    } catch (err) {
      if (err instanceof LeagueNotFoundError) {
        return sendError(reply, 404, 'LEAGUE_NOT_FOUND', err.message);
      }

      if (err instanceof LeagueOperationError) {
        return sendError(reply, err.statusCode, err.code, err.message);
      }

      throw err;
    }
  }
}
