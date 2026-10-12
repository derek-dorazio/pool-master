import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ErrorEnvelope } from '@poolmaster/shared/dto/errors.dto';
import { buildRequestLogBindings } from './logger';
import { isApiErrorCode, type ApiErrorCode } from '@poolmaster/shared/dto';

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

/**
 * The code a client sees: a listed `ApiErrorCode`, or Fastify's own `FST_ERR_*` code as it is.
 * Any other runtime code (a Prisma `P2002`, a Node `ECONNREFUSED`) is an internal detail, so it
 * becomes `INTERNAL_ERROR` on a 5xx and `BAD_REQUEST` on a 4xx; the log still carries the error.
 */
function inferErrorCode(error: ErrorLike, statusCode: number): string {
  if (error.code !== undefined && (isApiErrorCode(error.code) || error.code.startsWith('FST_ERR_'))) {
    return error.code;
  }

  const fallback: ApiErrorCode = statusCode >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
  return fallback;
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
  code: ApiErrorCode,
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
