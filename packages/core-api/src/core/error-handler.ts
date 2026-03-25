import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

export function globalErrorHandler(
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  const statusCode = error.statusCode ?? 500;

  reply.status(statusCode).send({
    error: error.code ?? 'INTERNAL_ERROR',
    message: error.message,
    details: statusCode === 400 ? error.validation : undefined,
  });
}
