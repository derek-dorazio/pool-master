/**
 * Contest template route handlers — template CRUD.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { ContestType, Sport } from '@poolmaster/shared/domain';
import type { ContestTemplateService } from './template-service';
import { TemplateNotFoundError, TemplateOperationError } from './template-service';
import { mapContestTemplateToDto } from '../../mappers';
import { z } from 'zod';

const CreateTemplateBodySchema = z.object({
  leagueId: z.string().min(1),
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  sport: z.enum([
    Sport.GOLF,
    Sport.NFL,
    Sport.NBA,
    Sport.F1,
    Sport.NASCAR,
    Sport.NCAA_BASKETBALL,
    Sport.NCAA_HOCKEY,
    Sport.NCAA_FOOTBALL,
    Sport.TENNIS,
    Sport.HORSE_RACING,
    Sport.SOCCER,
    Sport.NHL,
    Sport.MLB,
    Sport.UFC,
  ]),
  contestType: z.enum([ContestType.SINGLE_EVENT]),
  draftConfig: z.record(z.unknown()).optional(),
  scoringConfig: z.record(z.unknown()).optional(),
  payoutConfig: z.record(z.unknown()).optional(),
  poolConfig: z.record(z.unknown()).optional(),
  sharedWithTenant: z.boolean().optional(),
});

const UpdateTemplateBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional(),
  draftConfig: z.record(z.unknown()).optional(),
  scoringConfig: z.record(z.unknown()).optional(),
  payoutConfig: z.record(z.unknown()).optional(),
  poolConfig: z.record(z.unknown()).optional(),
  sharedWithTenant: z.boolean().optional(),
});

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
  ): Promise<{ templates: ReturnType<typeof mapContestTemplateToDto>[] }> {
    const templates = await templateService.listTemplates(request.query.leagueId);
    return { templates: templates.map(mapContestTemplateToDto) };
  }

  async function createTemplate(
    request: FastifyRequest<{ Body: z.infer<typeof CreateTemplateBodySchema> }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.headers['x-user-id'] as string;
    if (!userId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing user identity' });
    }
    const body = CreateTemplateBodySchema.parse(request.body);
    const template = await templateService.createTemplate({
      leagueId: body.leagueId,
      createdBy: userId,
      name: body.name,
      description: body.description,
      sport: body.sport,
      contestType: body.contestType,
      draftConfig: body.draftConfig ?? {},
      scoringConfig: body.scoringConfig ?? {},
      payoutConfig: body.payoutConfig ?? {},
      poolConfig: body.poolConfig ?? {},
      sharedWithTenant: body.sharedWithTenant,
    });
    return reply.status(201).send({ template: mapContestTemplateToDto(template) });
  }

  async function getTemplate(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const template = await templateService.getTemplate(request.params.id);
    if (!template) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Template not found' });
    }
    return reply.send({ template: mapContestTemplateToDto(template) });
  }

  async function updateTemplate(
    request: FastifyRequest<{
      Params: { id: string };
      Body: z.infer<typeof UpdateTemplateBodySchema>;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const body = UpdateTemplateBodySchema.parse(request.body);
      const template = await templateService.updateTemplate(
        request.params.id,
        {
          name: body.name,
          description: body.description,
          draftConfig: body.draftConfig,
          scoringConfig: body.scoringConfig,
          payoutConfig: body.payoutConfig,
          poolConfig: body.poolConfig,
          sharedWithTenant: body.sharedWithTenant,
        },
      );
      return reply.send({ template: mapContestTemplateToDto(template) });
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
      return reply.send({ success: true });
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
