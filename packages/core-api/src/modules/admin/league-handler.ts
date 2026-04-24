import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AdminLeagueService } from './league-service';
import { LeagueNotFoundError, LeagueOperationError } from './league-service';
import { sendError } from '../../core/error-handler';
import { extractRootAdminContext } from './request-admin-context';

export function createLeagueAdminHandlers(adminLeagueService: AdminLeagueService) {
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
    const leagues = await adminLeagueService.searchLeagues({
      search: request.query.search,
      isActive: request.query.isActive,
    });

    return {
      leagues,
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
