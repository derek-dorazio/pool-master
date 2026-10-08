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

  it('an error with no code or status reaches the client as INTERNAL_ERROR, whatever its class name', () => {
    const renamed = Object.assign(new Error('boom'), { name: 'LeagueNotFoundError' });

    expect(createErrorEnvelopeFromError(renamed)).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'boom' },
    });
  });
});
