import { RecordType } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { RECORD_WORDING, describeRecordStand } from './record-book-view';

describe('record book wording', () => {
  it('counts a run as so many in a row, and a run of one as just one', () => {
    expect(RECORD_WORDING[RecordType.LONGEST_PODIUM_RUN].value(3)).toBe('3 podiums in a row');
    expect(RECORD_WORDING[RecordType.LONGEST_PODIUM_RUN].value(1)).toBe('1 podium');
    expect(RECORD_WORDING[RecordType.BACK_TO_BACK_CHAMPIONS].value(2)).toBe('2 years in a row');
  });

  it('names a repeat winner by its years in a row with the contest', () => {
    expect(RECORD_WORDING[RecordType.REPEAT_WINNER].title).toBe('Most repeat wins');
    expect(RECORD_WORDING[RecordType.REPEAT_WINNER].value(3)).toBe('3 years in a row');
    expect(describeRecordStand(RecordType.REPEAT_WINNER, {
      value: 3,
      holders: [{
        squad: { squadId: 'team-1', squadName: 'Eagles', squadIconKey: 'CAPTAIN_SMILE_FIELD' },
        year: 2026,
        contestId: '11111111-1111-4111-8111-111111111111',
        contestName: 'Masters Pick 6',
      }],
    })).toBe('3 years in a row · Eagles, Masters Pick 6 (2026)');
  });

  it('counts wins, championships and entries in the singular for one', () => {
    expect(RECORD_WORDING[RecordType.MOST_WINS_ALL_TIME].value(1)).toBe('1 win');
    expect(RECORD_WORDING[RecordType.MOST_CHAMPIONSHIPS].value(2)).toBe('2 championships');
    expect(RECORD_WORDING[RecordType.BIGGEST_FIELD_WON].value(1)).toBe('1 entry');
  });
});
