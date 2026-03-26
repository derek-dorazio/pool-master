/**
 * League route handlers — league CRUD and settings management.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { extractTenantContext } from '../../core/tenant-context';
import type { CreateLeagueInput, LeagueService } from './service';
import { LeagueNotFoundError } from './service';

export function createLeagueHandlers(leagueService: LeagueService) {
  return {
    listLeagues,
    createLeague,
    getLeague,
    updateSettings,
  };

  async function listLeagues(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<{ leagues: unknown[] }> {
    const { tenantId } = extractTenantContext(request);
    const leagues = await leagueService.findByTenant(tenantId);
    return { leagues };
  }

  async function createLeague(
    request: FastifyRequest<{
      Body: {
        name: string;
        description?: string;
        visibility: string;
        maxMembers?: number;
        settings?: Record<string, unknown>;
      };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tenantId } = extractTenantContext(request);
    const userId = request.headers['x-user-id'] as string;
    if (!userId) {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: 'Missing user identity' });
    }
    const body = request.body;
    const input: CreateLeagueInput = {
      tenantId,
      createdBy: userId,
      name: body.name,
      description: body.description,
      visibility: body.visibility as CreateLeagueInput['visibility'],
      maxMembers: body.maxMembers,
      settings: body.settings as CreateLeagueInput['settings'],
    };
    const result = await leagueService.createLeague(input);
    return reply.status(201).send(result);
  }

  async function getLeague(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tenantId } = extractTenantContext(request);
    const result = await leagueService.getLeagueWithMembers(request.params.id, tenantId);
    if (!result) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'League not found' });
    }
    return reply.send(result);
  }

  async function updateSettings(
    request: FastifyRequest<{
      Params: { id: string };
      Body: Record<string, unknown>;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const { tenantId } = extractTenantContext(request);
    try {
      const league = await leagueService.updateSettings(
        request.params.id,
        tenantId,
        request.body as Parameters<LeagueService['updateSettings']>[2],
      );
      return reply.send({ league });
    } catch (err) {
      if (err instanceof LeagueNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }
}
