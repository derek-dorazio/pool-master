import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  UpdateContestConfigTemplateRequest,
  ListContestConfigTemplatesQuery,
} from '@poolmaster/shared/dto';
import { sendError } from '../../core/error-handler';
import {
  ContestConfigTemplateNotFoundError,
  ContestConfigTemplateRulesMismatchError,
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
      Body: UpdateContestConfigTemplateRequest;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const template = await service.updateTemplate(
        request.params.templateId,
        request.body,
      );
      return reply.send({ template });
    } catch (error) {
      if (error instanceof ContestConfigTemplateNotFoundError) {
        return sendError(reply, 404, 'CONTEST_CONFIG_TEMPLATE_NOT_FOUND', error.message);
      }
      if (error instanceof ContestConfigTemplateRulesMismatchError) {
        return sendError(reply, 422, 'CONTEST_CONFIG_TEMPLATE_RULES_MISMATCH', error.message);
      }

      throw error;
    }
  }
}
