import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { ErrorEnvelope } from '@poolmaster/shared/dto/errors.dto';
import { buildRequestLogBindings } from './logger';

type ErrorLike = Error & {
  code?: string;
  statusCode?: number;
  validation?: unknown;
};

function inferStatusCode(error: ErrorLike): number {
  if (typeof error.statusCode === 'number') {
    return error.statusCode;
  }

  switch (error.name) {
    case 'ContestNotFoundError':
    case 'ContestEntryNotFoundError':
    case 'LeagueNotFoundError':
    case 'ParticipantNotFoundError':
    case 'InvitationNotFoundError':
    case 'MemberNotFoundError':
    case 'SquadNotFoundError':
    case 'UserNotFoundError':
    case 'ProviderNotFoundError':
    case 'ProviderEventNotFoundError':
    case 'ErrorLogEntryNotFoundError':
    case 'AlertRuleNotFoundError':
      return 404;
    default:
      return 500;
  }
}

function inferErrorCode(error: ErrorLike, statusCode: number): string {
  if (typeof error.code === 'string' && error.code.length > 0) {
    return error.code;
  }

  switch (error.name) {
    case 'ContestNotFoundError':
      return 'CONTEST_NOT_FOUND';
    case 'ContestEntryNotFoundError':
      return 'CONTEST_ENTRY_NOT_FOUND';
    case 'LeagueNotFoundError':
      return 'LEAGUE_NOT_FOUND';
    case 'ParticipantNotFoundError':
      return 'PARTICIPANT_NOT_FOUND';
    case 'InvitationNotFoundError':
      return 'LEAGUE_INVITATION_NOT_FOUND';
    case 'MemberNotFoundError':
      return 'LEAGUE_MEMBER_NOT_FOUND';
    case 'SquadNotFoundError':
      return 'SQUAD_NOT_FOUND';
    case 'UserNotFoundError':
      return 'USER_NOT_FOUND';
    case 'ProviderNotFoundError':
      return 'PROVIDER_NOT_FOUND';
    case 'ProviderEventNotFoundError':
      return 'PROVIDER_EVENT_NOT_FOUND';
    case 'ErrorLogEntryNotFoundError':
      return 'ERROR_LOG_ENTRY_NOT_FOUND';
    case 'AlertRuleNotFoundError':
      return 'ALERT_RULE_NOT_FOUND';
    case 'ContestOperationError':
    case 'ContestEntryOperationError':
    case 'InvitationInvalidError':
    case 'MemberOperationError':
    case 'SquadOperationError':
    case 'ContestManagementError':
      return 'BAD_REQUEST';
    default:
      return statusCode >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
  }
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
  error: FastifyError,
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
