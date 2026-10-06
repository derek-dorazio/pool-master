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
 * The parameters are `Partial<R>` / `Partial<FastifyReply>`, so a field the double does set
 * is checked against its declared type (`params: { providerId: 123 }` fails). What this does
 * NOT check: a bare `jest.fn()` method is `jest.Mock<any, any>` and fits any signature, and
 * the members left out are simply absent at run time. This replaces `as any`; it is not a
 * licence to cast anything else.
 */
export function asFastifyRequest<R extends FastifyRequest = FastifyRequest>(
  double: Partial<R>,
): R {
  return double as R;
}

export function asFastifyReply(double: Partial<FastifyReply>): FastifyReply {
  return double as FastifyReply;
}
