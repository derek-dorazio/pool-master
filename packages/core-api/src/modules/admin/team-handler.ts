import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AdminTeamService } from './team-service';

export function createTeamAdminHandlers(adminTeamService: AdminTeamService) {
  return {
    listTeams,
  };

  async function listTeams(
    request: FastifyRequest<{
      Querystring: {
        search?: string;
        leagueCode?: string;
        isActive?: boolean;
      };
    }>,
    _reply: FastifyReply,
  ) {
    const teams = await adminTeamService.searchTeams({
      search: request.query.search,
      leagueCode: request.query.leagueCode,
      isActive: request.query.isActive,
    });

    return {
      teams,
    };
  }
}
