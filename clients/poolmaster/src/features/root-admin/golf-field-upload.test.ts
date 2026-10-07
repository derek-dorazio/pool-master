import { describe, expect, it } from 'vitest';
import {
  formatGolfFieldUploadValues,
  golfFieldUploadBlockedCount,
  golfFieldUploadTemplateRows,
  parseGolfFieldUpload,
  type GolfFieldUploadPreviewRow,
} from './golf-field-upload';
import { fieldEntryFixture, participantFixture } from './golf-test-fixtures';

describe('parseGolfFieldUpload', () => {
  it('omits a blank CSV cell, clears a value written as null, and reads isActive words and inactiveReason in any case', () => {
    const rows = parseGolfFieldUpload(
      'externalId,playerName,ranking,oddsToWin,seedNumber,isActive,inactiveReason\n'
      + 'ext-1,,3,NULL,,no,withdrawn\n'
      + ',Rory McIlroy,,12.5,4,YES,null',
      'CSV',
    );

    expect(rows).toEqual([
      { externalId: 'ext-1', ranking: 3, oddsToWin: null, isActive: false, inactiveReason: 'WITHDRAWN' },
      { playerName: 'Rory McIlroy', oddsToWin: 12.5, seedNumber: 4, isActive: true, inactiveReason: null },
    ]);
  });

  it('takes JSON nulls as clears and leaves keys a JSON row does not name out of the request', () => {
    expect(parseGolfFieldUpload('[{"participantId":"p-1","ranking":null,"isActive":true}]', 'JSON')).toEqual([
      { participantId: 'p-1', ranking: null, isActive: true },
    ]);
  });

  it('rejects a row with no identifier, a non-numeric ranking, an unknown isActive word or an unknown reason, naming the row and column', () => {
    expect(() => parseGolfFieldUpload('ranking\n4', 'CSV')).toThrow(/Row 1: each row needs a participantId, externalId, or playerName/);
    expect(() => parseGolfFieldUpload('playerName,ranking\nRory,first', 'CSV')).toThrow(/Row 1 \(ranking\)/);
    expect(() => parseGolfFieldUpload('playerName,isActive\nRory,maybe', 'CSV')).toThrow(/Row 1 \(isActive\)/);
    expect(() => parseGolfFieldUpload('playerName,inactiveReason\nRory,INJURED', 'CSV')).toThrow(/Row 1 \(inactiveReason\)/);
    expect(() => parseGolfFieldUpload('[]', 'JSON')).toThrow('No rows found.');
  });
});

describe('golf field upload helpers', () => {
  it('pre-fills the template with each field golfer\'s stored values, blanks where none', () => {
    const entries = [
      fieldEntryFixture({
        participant: participantFixture({ name: 'Rory McIlroy', externalId: 'ext-rory' }),
        ranking: 2,
        oddsToWin: null,
        seedNumber: 1,
        isActive: false,
        inactiveReason: 'WITHDRAWN',
      }),
    ];

    expect(golfFieldUploadTemplateRows(entries)).toEqual([['ext-rory', 'Rory McIlroy', 2, '', 1, 'false', 'WITHDRAWN']]);
  });

  it('formats a row\'s values for the preview, showing unset values and an inactive reason in words', () => {
    expect(formatGolfFieldUploadValues(null)).toBe('—');
    expect(formatGolfFieldUploadValues({ isActive: false, inactiveReason: 'WITHDRAWN', ranking: null, oddsToWin: 7, seedNumber: null }))
      .toBe('unranked · odds 7 · unseeded · Withdrawn');
    expect(formatGolfFieldUploadValues({ isActive: false, inactiveReason: null, ranking: 1, oddsToWin: null, seedNumber: 3 }))
      .toBe('#1 · no odds · seed 3 · Inactive');
  });

  it('counts a row Apply would refuse: unresolved, ambiguous, or a duplicate', () => {
    const base = { row: {}, participantId: null, participantName: null, sportEventParticipantId: null, change: null, before: null, after: null, message: null };
    const rows: GolfFieldUploadPreviewRow[] = [
      { ...base, resolution: 'MATCHED', rowError: null, change: 'UNCHANGED' },
      { ...base, resolution: 'MATCHED', rowError: 'DUPLICATE_PARTICIPANT' },
      { ...base, resolution: 'AMBIGUOUS', rowError: null },
      { ...base, resolution: 'UNRESOLVED', rowError: null },
    ];

    expect(golfFieldUploadBlockedCount(rows)).toBe(3);
  });
});
