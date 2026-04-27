import type { FastifyReply, FastifyRequest } from 'fastify';
import { toServiceVersionResponse } from '../../mappers/version.mapper';
import type { VersionService } from './service';

export function createVersionHandlers(versionService: VersionService) {
  return {
    getVersion,
  };

  async function getVersion(
    request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    const logger = request.contextLogger ?? request.log;
    const response = toServiceVersionResponse(versionService.getVersion());

    logger.debug(
      {
        action: 'version.route.get.success',
        data: {
          environment: response.environment,
          serviceVersion: response.service.version,
          serviceGitSha: response.service.gitSha,
          buildNumber: response.service.buildNumber,
        },
      },
      'Returned service version metadata',
    );

    return response;
  }
}
