import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthUser } from '../../packages/core-api/src/plugins/auth-guard';
import { asFastifyReply, asFastifyRequest } from './fastify-doubles';
import { fakeLogger } from './fake-logger';

/**
 * Calling a route handler with no Fastify app (#1482): a stub request carrying only the fields
 * the handler reads, and a reply that records the status, headers and body it was given.
 */
export interface RecordedReply {
  statusCode: number;
  body: unknown;
  headers: Record<string, unknown>;
}

interface ReplyDouble {
  readonly statusCode: number;
  code: jest.Mock<ReplyDouble, [number]>;
  status: jest.Mock<ReplyDouble, [number]>;
  header: jest.Mock<ReplyDouble, [string, unknown]>;
  send: jest.Mock<ReplyDouble, [unknown?]>;
}

function replyDouble(): { reply: ReplyDouble; recorded: RecordedReply } {
  const recorded: RecordedReply = { statusCode: 200, body: undefined, headers: {} };
  const reply: ReplyDouble = {
    get statusCode() {
      return recorded.statusCode;
    },
    code: jest.fn((status: number) => {
      recorded.statusCode = status;
      return reply;
    }),
    status: jest.fn((status: number) => {
      recorded.statusCode = status;
      return reply;
    }),
    header: jest.fn((name: string, value: unknown) => {
      recorded.headers[name.toLowerCase()] = value;
      return reply;
    }),
    send: jest.fn((body?: unknown) => {
      recorded.body = body;
      return reply;
    }),
  };
  return { reply, recorded };
}

/** A signed-in caller, a root admin only when asked. */
export function authUser(userId = 'user-1', overrides: Partial<AuthUser> = {}): AuthUser {
  return { userId, email: `${userId}@example.test`, isRootAdmin: false, sessionId: 'session-1', ...overrides };
}

export interface StubRequest {
  params?: unknown;
  query?: unknown;
  body?: unknown;
  headers?: Record<string, string | undefined>;
  ip?: string;
  authUser?: AuthUser;
  /** False for a request the context logger plugin has not decorated; handlers then log on `request.log`. */
  contextLogger?: false;
}

/** A request with a logger on it, as Fastify gives every request. */
export function stubRequest(fields: StubRequest = {}): FastifyRequest {
  const { contextLogger, ...rest } = fields;
  const log = fakeLogger();
  return asFastifyRequest({ id: 'req-1', method: 'POST', url: '/api/v1/test', routeOptions: { url: '/api/v1/test' }, ip: '127.0.0.1', headers: {}, ...rest, log, contextLogger: contextLogger === false ? undefined : log } as unknown as Partial<FastifyRequest>);
}

type AnyHandler = (request: never, reply: FastifyReply) => unknown;

/**
 * Runs `handler` and answers what it sent: the status (200 unless set), the body (the reply's,
 * or what the handler returned when it returns its answer instead) and the headers.
 */
export async function callHandler(handler: AnyHandler, request: FastifyRequest): Promise<RecordedReply> {
  const { reply, recorded } = replyDouble();
  const returned: unknown = await handler(request as never, asFastifyReply(reply as unknown as Partial<FastifyReply>));
  if (recorded.body === undefined && returned !== reply) recorded.body = returned;
  return recorded;
}
