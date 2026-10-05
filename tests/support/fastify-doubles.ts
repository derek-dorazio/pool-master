import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Hand a partial Fastify request or reply double to a handler (#345 Phase 2 PR 3).
 *
 * A handler test builds only the request fields and reply methods the handler touches. Keep
 * that literal uncast, so the test reads `reply.send` as the `jest.Mock` it is, and cross
 * into the Fastify type here, once, at the call — the same shape as `asPrismaClient`:
 *
 *     const reply = { status: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis() };
 *     await handler(asFastifyRequest<Request>({ params, query }), asFastifyReply(reply));
 *     expect(reply.send).toHaveBeenCalledWith(...);
 *
 * The parameter types reject a double none of whose keys is a request/reply member, but not
 * a single misspelt key alongside correct ones. This replaces `as any`; it is not a licence
 * to cast anything else.
 */
export function asFastifyRequest<R extends FastifyRequest = FastifyRequest>(
  double: { [K in keyof R]?: unknown },
): R {
  return double as R;
}

export function asFastifyReply(double: { [K in keyof FastifyReply]?: unknown }): FastifyReply {
  return double as FastifyReply;
}
