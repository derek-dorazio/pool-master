/**
 * Bulk operations route handlers — season bulk setup, copy season, CSV import.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { BulkService, CsvImportRow } from './bulk-service';
import { BulkOperationError } from './bulk-service';
import { sendError } from '../../core/error-handler';

export function createBulkHandlers(bulkService: BulkService) {
  return {
    copySeason,
    importMembers,
  };

  async function copySeason(
    request: FastifyRequest<{
      Params: { id: string };
      Body: { sourceContestIds: string[] };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.headers['x-user-id'] as string;
    const result = await bulkService.copyLastSeason({
      leagueId: request.params.id,
      tenantId: '',
      createdBy: userId,
      sourceContestIds: request.body.sourceContestIds,
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
        return sendError(reply, 400, 'BAD_REQUEST', err.message);
      }
      throw err;
    }
  }
}
