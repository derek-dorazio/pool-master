/**
 * Contest template route handlers — template CRUD.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ContestTemplateService } from './template-service';
import { TemplateNotFoundError, TemplateOperationError } from './template-service';

export function createTemplateHandlers(templateService: ContestTemplateService) {
  return {
    listTemplates,
    createTemplate,
    getTemplate,
    updateTemplate,
    deleteTemplate,
  };

  async function listTemplates(
    request: FastifyRequest<{ Querystring: { leagueId: string } }>,
    _reply: FastifyReply,
  ): Promise<{ templates: unknown[] }> {
    const templates = await templateService.listTemplates(request.query.leagueId);
    return { templates };
  }

  async function createTemplate(
    request: FastifyRequest<{ Body: Record<string, unknown> }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.headers['x-user-id'] as string;
    if (!userId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing user identity' });
    }
    const body = request.body;
    const template = await templateService.createTemplate({
      leagueId: body.leagueId as string,
      createdBy: userId,
      name: body.name as string,
      description: body.description as string | undefined,
      sport: body.sport as any,
      contestType: body.contestType as any,
      draftConfig: (body.draftConfig ?? {}) as Record<string, unknown>,
      scoringConfig: (body.scoringConfig ?? {}) as Record<string, unknown>,
      payoutConfig: (body.payoutConfig ?? {}) as Record<string, unknown>,
      poolConfig: (body.poolConfig ?? {}) as Record<string, unknown>,
      sharedWithTenant: body.sharedWithTenant as boolean | undefined,
    });
    return reply.status(201).send({ template });
  }

  async function getTemplate(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const template = await templateService.getTemplate(request.params.id);
    if (!template) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Template not found' });
    }
    return reply.send({ template });
  }

  async function updateTemplate(
    request: FastifyRequest<{
      Params: { id: string };
      Body: Record<string, unknown>;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const template = await templateService.updateTemplate(
        request.params.id,
        request.body as any,
      );
      return reply.send({ template });
    } catch (err) {
      if (err instanceof TemplateNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof TemplateOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }

  async function deleteTemplate(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      await templateService.deleteTemplate(request.params.id);
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof TemplateNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof TemplateOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }
}
