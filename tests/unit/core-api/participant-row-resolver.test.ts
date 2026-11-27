import type { Participant } from '@poolmaster/shared/domain';
import { feedIdsOfCandidates, matchAmong, resolveParticipantRow } from '../../../packages/core-api/src/modules/sport-catalog/participant-row-resolver';

// The one resolver for a result row that names a participant (#236): by id or by a feed id, never
// by name (#2114).

const field = [
  { id: 'p-1', name: 'Scottie Scheffler' },
  { id: 'p-2', name: 'Rory McIlroy' },
  { id: 'p-3', name: 'Tom Kim' },
  { id: 'p-4', name: 'tom kim' },
] as Participant[];
// A participant's feed ids are its provider mappings' (#2040).
const feedIds = new Map([['p-1', new Set(['ext-1'])], ['p-2', new Set(['ext-2'])]]);

describe('resolveParticipantRow', () => {
  it('matches by participantId, then a feed id one of its provider mappings holds', async () => {
    const find = matchAmong(field, feedIds);

    await expect(resolveParticipantRow({ participantId: 'p-1', externalId: 'ext-2' }, find))
      .resolves.toMatchObject({ resolution: 'MATCHED', participant: { id: 'p-1' } });
    await expect(resolveParticipantRow({ externalId: 'ext-2' }, find))
      .resolves.toMatchObject({ resolution: 'MATCHED', participant: { id: 'p-2' } });
  });

  it('uses only the first identifier present: an unmatched participantId is unresolved, not retried by feed id', async () => {
    await expect(resolveParticipantRow({ participantId: 'p-9', externalId: 'ext-2' }, matchAmong(field, feedIds)))
      .resolves.toEqual({ resolution: 'UNRESOLVED', participant: null });
  });

  it('never matches by name: a row that gives only a player name is unresolved, even when one participant has that name', async () => {
    const nameOnly = { playerName: 'Rory McIlroy' } as unknown as Parameters<typeof resolveParticipantRow>[0];
    await expect(resolveParticipantRow(nameOnly, matchAmong(field, feedIds)))
      .resolves.toEqual({ resolution: 'UNRESOLVED', participant: null });
  });

  it('is ambiguous when several candidates match, and unresolved with no identifier at all', async () => {
    const shared = new Map([['p-3', new Set(['ext-3'])], ['p-4', new Set(['ext-3'])]]);
    await expect(resolveParticipantRow({ externalId: 'ext-3' }, matchAmong(field, shared)))
      .resolves.toEqual({ resolution: 'AMBIGUOUS', participant: null });
    await expect(resolveParticipantRow({}, matchAmong(field)))
      .resolves.toEqual({ resolution: 'UNRESOLVED', participant: null });
  });
});

describe('feedIdsOfCandidates', () => {
  const mappings = (rows: Array<{ participantId: string; externalId: string }>) => ({ findByParticipantIds: jest.fn().mockResolvedValue(rows) });

  it('reads the candidates\' provider mappings once and groups their feed ids by participant, when a row is matched by feed id', async () => {
    const repo = mappings([
      { participantId: 'p-1', externalId: 'ext-1' },
      { participantId: 'p-1', externalId: 'ext-1b' },
      { participantId: 'p-2', externalId: 'ext-2' },
    ]);
    const ids = await feedIdsOfCandidates([{ externalId: 'ext-1b' }, { participantId: 'p-3' }], field, repo);
    expect(repo.findByParticipantIds).toHaveBeenCalledTimes(1);
    expect(repo.findByParticipantIds).toHaveBeenCalledWith(['p-1', 'p-2', 'p-3', 'p-4']);
    expect(ids.get('p-1')).toEqual(new Set(['ext-1', 'ext-1b']));
    await expect(resolveParticipantRow({ externalId: 'ext-1b' }, matchAmong(field, ids)))
      .resolves.toMatchObject({ resolution: 'MATCHED', participant: { id: 'p-1' } });
  });

  it('reads nothing when no row is matched by feed id, or there are no candidates', async () => {
    const repo = mappings([]);
    await expect(feedIdsOfCandidates([{ participantId: 'p-1', externalId: 'ext-1' }, { participantId: 'p-3' }], field, repo as never)).resolves.toEqual(new Map());
    await expect(feedIdsOfCandidates([{ externalId: 'ext-1' }], [], repo as never)).resolves.toEqual(new Map());
    expect(repo.findByParticipantIds).not.toHaveBeenCalled();
  });
});
