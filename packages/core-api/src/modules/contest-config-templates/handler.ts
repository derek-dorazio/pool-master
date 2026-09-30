import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  AdminUpdateContestConfigTemplateRequest,
  ListContestConfigTemplatesQuery,
} from '@poolmaster/shared/dto';
import { sendError } from '../../core/error-handler';
import { extractRootAdminContext } from '../admin/request-admin-context';
import {
  ContestConfigTemplateNotFoundError,
  type ContestConfigTemplateService,
} from './service';

export function createContestConfigTemplateHandlers(
  service: ContestConfigTemplateService,
) {
  return {
    listTemplates,
    updateTemplate,
  };

  async function listTemplates(
    request: FastifyRequest<{
      Querystring: ListContestConfigTemplatesQuery;
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

      throw error;
    }
  }
}
