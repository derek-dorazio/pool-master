import { RecordType } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import { RECORD_WORDING } from './record-book-view';

describe('record book wording', () => {
  it('counts a run as so many in a row, and a run of one as just one', () => {
    expect(RECORD_WORDING[RecordType.LONGEST_PODIUM_RUN].value(3)).toBe('3 podiums in a row');
    expect(RECORD_WORDING[RecordType.LONGEST_PODIUM_RUN].value(1)).toBe('1 podium');
    expect(RECORD_WORDING[RecordType.BACK_TO_BACK_CHAMPIONS].value(2)).toBe('2 years in a row');
  });

  it('counts wins, championships and entries in the singular for one', () => {
    expect(RECORD_WORDING[RecordType.MOST_WINS_ALL_TIME].value(1)).toBe('1 win');
    expect(RECORD_WORDING[RecordType.MOST_CHAMPIONSHIPS].value(2)).toBe('2 championships');
    expect(RECORD_WORDING[RecordType.BIGGEST_FIELD_WON].value(1)).toBe('1 entry');
  });
});
