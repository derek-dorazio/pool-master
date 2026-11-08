/**
 * ETag and 304 for the polled leaderboards (#1436), from the stored board's identity rather than
 * a hash of the body: an unchanged poll is answered without serializing the board at all.
 *
 * A stored board is the same for every reader of the contest, so its version and the moment it
 * began computing name it. The moment is part of the tag because a dropped board starts again at
 * version 1. The access check runs before this, so a reader turned away never gets a 304.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { LeaderboardRead } from './service';

/** The strong ETag of a stored board. */
export function leaderboardEtag(read: Pick<LeaderboardRead<unknown>, 'version' | 'computedFrom'>): string {
  return `"lb-${read.version}-${read.computedFrom.getTime()}"`;
}

/** Whether an If-None-Match header names this tag, or any tag (`*`). */
export function ifNoneMatchHas(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((tag) => {
    const trimmed = tag.trim();
    return trimmed === '*' || trimmed === etag || trimmed === `W/${etag}`;
  });
}

/**
 * Answers a leaderboard read with its ETag: 304 and no body when the reader already holds this
 * board, else the board mapped by `toResponse`.
 */
export function sendLeaderboard<Board>(
  request: FastifyRequest,
  reply: FastifyReply,
  read: LeaderboardRead<Board>,
  toResponse: (read: LeaderboardRead<Board>) => unknown,
): FastifyReply {
  const etag = leaderboardEtag(read);
  reply.header('ETag', etag);
  if (ifNoneMatchHas(request.headers['if-none-match'], etag)) return reply.code(304).send();
  return reply.send(toResponse(read));
}
