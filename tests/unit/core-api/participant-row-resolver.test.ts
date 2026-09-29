import type { Participant } from '@poolmaster/shared/domain';
import { matchAmong, resolveParticipantRow } from '../../../packages/core-api/src/modules/sport-catalog/participant-row-resolver';

// The one resolver both uploads use (#236): the affiliation upload and the golf score
// upload each had a copy of this precedence before.

const field = [
  { id: 'p-1', name: 'Scottie Scheffler', externalId: 'ext-1' },
  { id: 'p-2', name: 'Rory McIlroy', externalId: 'ext-2' },
  { id: 'p-3', name: 'Tom Kim' },
  { id: 'p-4', name: 'tom kim' },
] as Participant[];

describe('resolveParticipantRow', () => {
  it('matches by participantId, then externalId, then exact case-insensitive name', async () => {
    const find = matchAmong(field);

    await expect(resolveParticipantRow({ participantId: 'p-1', externalId: 'ext-2' }, find))
      .resolves.toMatchObject({ resolution: 'MATCHED', participant: { id: 'p-1' } });
    await expect(resolveParticipantRow({ externalId: 'ext-2', playerName: 'Scottie Scheffler' }, find))
      .resolves.toMatchObject({ resolution: 'MATCHED', participant: { id: 'p-2' } });
    await expect(resolveParticipantRow({ playerName: 'RORY MCILROY' }, find))
      .resolves.toMatchObject({ resolution: 'MATCHED', participant: { id: 'p-2' } });
  });

  it('uses only the first identifier present: an unmatched participantId is unresolved, not retried by name', async () => {
    await expect(resolveParticipantRow({ participantId: 'p-9', playerName: 'Rory McIlroy' }, matchAmong(field)))
      .resolves.toEqual({ resolution: 'UNRESOLVED', participant: null });
  });

  it('is ambiguous when several candidates match, and unresolved with no identifier at all', async () => {
    await expect(resolveParticipantRow({ playerName: 'Tom Kim' }, matchAmong(field)))
      .resolves.toEqual({ resolution: 'AMBIGUOUS', participant: null });
    await expect(resolveParticipantRow({}, matchAmong(field)))
      .resolves.toEqual({ resolution: 'UNRESOLVED', participant: null });
  });
});
