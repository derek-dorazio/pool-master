/**
 * Bulk operations route handlers — season bulk setup, copy season, CSV import.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { BulkService, CsvImportRow } from './bulk-service';
import { BulkOperationError } from './bulk-service';

export function createBulkHandlers(bulkService: BulkService) {
  return {
    bulkCreateContests,
    copySeason,
    importMembers,
  };

  async function bulkCreateContests(
    request: FastifyRequest<{
      Params: { id: string };
      Body: {
        templateId: string;
        namingPattern: string;
        events: { name: string; startsAt?: string; endsAt?: string }[];
      };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.headers['x-user-id'] as string;
    const tenantId = (request.headers['x-tenant-id'] as string) ?? '';
    try {
      const result = await bulkService.bulkCreateContests({
        leagueId: request.params.id,
        tenantId,
        createdBy: userId,
        templateId: request.body.templateId,
        namingPattern: request.body.namingPattern,
        events: request.body.events.map((e) => ({
          name: e.name,
          startsAt: e.startsAt ? new Date(e.startsAt) : undefined,
          endsAt: e.endsAt ? new Date(e.endsAt) : undefined,
        })),
      });
      return reply.status(201).send(result);
    } catch (err) {
      if (err instanceof BulkOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }

  async function copySeason(
    request: FastifyRequest<{
      Params: { id: string };
      Body: { sourceContestIds: string[]; seasonId?: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.headers['x-user-id'] as string;
    const tenantId = (request.headers['x-tenant-id'] as string) ?? '';
    const result = await bulkService.copyLastSeason({
      leagueId: request.params.id,
      tenantId,
      createdBy: userId,
      sourceContestIds: request.body.sourceContestIds,
      seasonId: request.body.seasonId,
    });
    return reply.status(201).send(result);
  }

  async function importMembers(
    request: FastifyRequest<{
      Params: { id: string };
      Body: { rows: CsvImportRow[] };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.headers['x-user-id'] as string;
    try {
      const result = await bulkService.importMembersFromCsv(
        request.params.id,
        userId,
        request.body.rows,
      );
      return reply.status(201).send(result);
    } catch (err) {
      if (err instanceof BulkOperationError) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
      }
      throw err;
    }
  }
}
