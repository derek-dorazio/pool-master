import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  ContestConfigTemplateDto,
  UpdateContestConfigTemplateRequest,
  ListContestConfigTemplatesQuery,
} from '@poolmaster/shared/dto';
import { sendError } from '../../core/error-handler';
import type { ReadCache } from '../../core/read-cache';
import {
  ContestConfigTemplateNotFoundError,
  ContestConfigTemplateRulesMismatchError,
  type ContestConfigTemplateService,
} from './service';

/** `lists` keeps the public list by its filters (#1181); an update that lands clears it. */
export function createContestConfigTemplateHandlers(
  service: ContestConfigTemplateService,
  lists: ReadCache<ContestConfigTemplateDto[]>,
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
    const { sport, sportLeagueId, eventType, active } = request.query;
    const key = [sport, sportLeagueId, eventType, active].map((filter) => filter ?? '').join(':');
    const templates = await lists.get(key, new Date(), () => service.listTemplates(request.query));
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
      lists.clear();
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
