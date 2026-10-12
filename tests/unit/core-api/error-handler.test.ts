import { expect } from '@jest/globals';
import { createErrorEnvelopeFromError } from '../../../packages/core-api/src/core/error-handler';
import { ContestEntryNotFoundError, ContestNotFoundError } from '../../../packages/core-api/src/modules/contests/service';
import { InvitationNotFoundError } from '../../../packages/core-api/src/modules/leagues/invitation-service';
import { MemberNotFoundError } from '../../../packages/core-api/src/modules/leagues/member-service';
import { LeagueNotFoundError } from '../../../packages/core-api/src/modules/leagues/service';
import { ParticipantNotFoundError } from '../../../packages/core-api/src/modules/participants/service';
import { SquadNotFoundError } from '../../../packages/core-api/src/modules/squads/errors';

describe('global error handler envelopes', () => {
  it.each([
    [new ContestNotFoundError('c-1'), 'CONTEST_NOT_FOUND'],
    [new ContestEntryNotFoundError('c-1', 's-1'), 'CONTEST_ENTRY_NOT_FOUND'],
    [new LeagueNotFoundError('l-1'), 'LEAGUE_NOT_FOUND'],
    [new ParticipantNotFoundError('p-1'), 'PARTICIPANT_NOT_FOUND'],
    [new InvitationNotFoundError('code-1'), 'LEAGUE_INVITATION_NOT_FOUND'],
    [new MemberNotFoundError('u-1', 'l-1'), 'LEAGUE_MEMBER_NOT_FOUND'],
    [new SquadNotFoundError('Squad not found'), 'SQUAD_NOT_FOUND'],
  ])('a thrown %p reaches the client as a 404 envelope with code %s', (error, code) => {
    expect(error.statusCode).toBe(404);
    expect(createErrorEnvelopeFromError(error)).toEqual({
      error: { code, message: error.message },
    });
  });

  it('an error with no code or status reaches the client as INTERNAL_ERROR with the generic message, whatever its class name', () => {
    const renamed = Object.assign(new Error('boom'), { name: 'LeagueNotFoundError' });

    expect(createErrorEnvelopeFromError(renamed)).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
    });
  });

  it.each([
    ['a Prisma message naming a table', Object.assign(new Error('Unique constraint failed on the fields: (`email`) in table `users`'), { code: 'P2002' })],
    ['a connection error naming a host', Object.assign(new Error('connect ECONNREFUSED db.internal:5432'), { code: 'ECONNREFUSED' })],
    ['a Fastify error on a 5xx', Object.assign(new Error('Reply was already sent'), { code: 'FST_ERR_REP_ALREADY_SENT', statusCode: 500 })],
  ])('%s never reaches the client: an unhandled 5xx sends the generic message', (_label, error) => {
    expect(createErrorEnvelopeFromError(error).error.message).toBe('Something went wrong. Please try again.');
  });

  it('keeps the authored message of a 5xx thrown with a listed code', () => {
    const unavailable = Object.assign(new Error('League deletion is not configured correctly'), { code: 'LEAGUE_DELETE_UNAVAILABLE', statusCode: 500 });

    expect(createErrorEnvelopeFromError(unavailable)).toEqual({
      error: { code: 'LEAGUE_DELETE_UNAVAILABLE', message: 'League deletion is not configured correctly' },
    });
  });

  it('keeps the message of a 4xx with an unlisted code, since a 4xx describes the request, not the server', () => {
    const conflict = Object.assign(new Error('nope'), { code: 'SOMETHING_UNLISTED', statusCode: 409 });

    expect(createErrorEnvelopeFromError(conflict).error.message).toBe('nope');
  });

  it.each([
    ['a Prisma unique violation on a 500', Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }), 'INTERNAL_ERROR'],
    ['a refused connection on a 500', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), 'INTERNAL_ERROR'],
    ['an unlisted code on a 4xx', Object.assign(new Error('nope'), { code: 'SOMETHING_UNLISTED', statusCode: 409 }), 'BAD_REQUEST'],
  ])('%s reaches the client as %s, never as the unlisted runtime code', (_label, error, code) => {
    expect(createErrorEnvelopeFromError(error).error.code).toBe(code);
  });

  it('keeps a Fastify FST_ERR_ code as it is, listed or not', () => {
    const mediaType = Object.assign(new Error('Unsupported Media Type'), { code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE', statusCode: 415 });

    expect(createErrorEnvelopeFromError(mediaType).error.code).toBe('FST_ERR_CTP_INVALID_MEDIA_TYPE');
  });
});
