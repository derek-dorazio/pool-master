/**
 * Bulk operations route handlers — CSV member import.
 *
 * #202 — `copySeason` is gone with its route; it had no frontend caller and the repo owner
 * removed it from scope.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { BulkService, CsvImportRow } from './bulk-service';
import { BulkOperationError } from './bulk-service';
import { sendError } from '../../core/error-handler';

export function createBulkHandlers(bulkService: BulkService) {
  return {
    importMembers,
  };

  async function importMembers(
    request: FastifyRequest<{
      Params: { id: string };
      Body: { rows: CsvImportRow[] };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = request.authUser?.userId as string;
    try {
      const result = await bulkService.importMembersFromCsv(
        request.params.id,
        userId,
        request.body.rows,
      );
      return reply.status(201).send(result);
    } catch (err) {
      if (err instanceof BulkOperationError) {
        const statusCode = err.code.endsWith('_NOT_FOUND') ? 404 : 400;
        return sendError(reply, statusCode, err.code, err.message);
      }
      throw err;
    }
  }
}
