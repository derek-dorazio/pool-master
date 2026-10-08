import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ErrorEnvelope } from '@poolmaster/shared/dto/errors.dto';
import { buildRequestLogBindings } from './logger';

/**
 * What the handler receives: Fastify's own errors carry `code`, `statusCode` and `validation`, and
 * domain errors carry their own `code` and, where they have one, `statusCode` (the not-found errors
 * declare 404). The handler reads those fields and never the error's class name.
 */
export type ErrorLike = Error & {
  code?: string;
  statusCode?: number;
  validation?: unknown;
};

function inferStatusCode(error: ErrorLike): number {
  return typeof error.statusCode === 'number' ? error.statusCode : 500;
}

function inferErrorCode(error: ErrorLike, statusCode: number): string {
  if (typeof error.code === 'string' && error.code.length > 0) {
    return error.code;
  }

  return statusCode >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
}

export function createErrorEnvelope(
  code: string,
  message: string,
  details?: unknown,
): ErrorEnvelope {
  return {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

export function createErrorEnvelopeFromError(error: ErrorLike): ErrorEnvelope {
  const statusCode = inferStatusCode(error);
  const details = statusCode === 400 ? error.validation : undefined;
  return createErrorEnvelope(
    inferErrorCode(error, statusCode),
    error.message,
    details,
  );
}

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
) {
  return reply.status(statusCode).send(createErrorEnvelope(code, message, details));
}

export function globalErrorHandler(
  error: ErrorLike,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const statusCode = inferStatusCode(error);
  const errorCode = inferErrorCode(error, statusCode);
  const logger = request.contextLogger ?? request.log;
  const logPayload = {
    action: statusCode >= 500 ? 'http.request.failed.unexpected' : 'http.request.failed.expected',
    statusCode,
    errorCode,
    err: error,
    data: {
      ...buildRequestLogBindings(request),
      ...(statusCode === 400 && error.validation !== undefined
        ? { validation: error.validation }
        : {}),
    },
  };

  if (statusCode >= 500) {
    logger.error(logPayload, 'Unhandled request error');
  } else {
    logger.warn(logPayload, 'Request completed with expected error');
  }

  reply.status(statusCode).send(createErrorEnvelopeFromError(error));
}
