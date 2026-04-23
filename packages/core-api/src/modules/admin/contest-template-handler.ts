import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  AdminListContestConfigTemplatesQuery,
  AdminUpdateContestConfigTemplateRequest,
} from '@poolmaster/shared/dto';
import { sendError } from '../../core/error-handler';
import { extractRootAdminContext } from './request-admin-context';
import {
  ContestConfigTemplateNotFoundError,
  ContestConfigTemplateUpdateError,
  ContestTemplateAdminService,
} from './contest-template-service';

export function createContestTemplateAdminHandlers(
  service: ContestTemplateAdminService,
) {
  return {
    listTemplates,
    updateTemplate,
  };

  async function listTemplates(
    request: FastifyRequest<{
      Querystring: AdminListContestConfigTemplatesQuery;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const templates = await service.listTemplates(request.query);
    return reply.send({ templates });
  }

  async function updateTemplate(
    request: FastifyRequest<{
      Params: { templateId: string };
      Body: AdminUpdateContestConfigTemplateRequest;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);

    try {
      const template = await service.updateTemplate(
        request.params.templateId,
        request.body,
        rootAdminUserId,
        rootAdminEmail,
      );
      return reply.send({ template });
    } catch (error) {
      if (error instanceof ContestConfigTemplateNotFoundError) {
        return sendError(reply, 404, 'CONTEST_CONFIG_TEMPLATE_NOT_FOUND', error.message);
      }

      if (error instanceof ContestConfigTemplateUpdateError) {
        return sendError(reply, 400, 'CONTEST_CONFIG_TEMPLATE_INVALID', error.message);
      }

      throw error;
    }
  }
}
