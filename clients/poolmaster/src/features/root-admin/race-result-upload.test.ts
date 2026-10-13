import { RaceResultStatus } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import {
  describeRaceResult,
  formatOrdinal,
  parseRaceResultUpload,
  raceResultTemplateRows,
} from './race-result-upload';
import { fieldEntryFixture, participantFixture } from './golf-test-fixtures';

const HEADER = 'externalId,playerName,finishPosition,resultStatus,startPosition,riderName';

describe('parseRaceResultUpload', () => {
  it('reads a place with no status as a finisher and keeps post position and rider as sent', () => {
    const rows = parseRaceResultUpload(`${HEADER}\nh-1,Sovereignty,1,,4,J. Alvarado`, 'CSV');

    expect(rows).toEqual([
      {
        externalId: 'h-1',
        playerName: 'Sovereignty',
        resultStatus: RaceResultStatus.FINISHED,
        finishPosition: 1,
        startPosition: 4,
        riderName: 'J. Alvarado',
      },
    ]);
  });

  it('skips a template row with neither a place nor a status, so only the runners filled in are sent', () => {
    const rows = parseRaceResultUpload(
      `${HEADER}\n,Sovereignty,1,,,\n,Journalism,,,,\n,Baeza,2,,,`,
      'CSV',
    );

    expect(rows.map((row) => row.playerName)).toEqual(['Sovereignty', 'Baeza']);
  });

  it('reads DNF, DQ and DNS as did not finish, disqualified and did not start, with no place', () => {
    const rows = parseRaceResultUpload(`${HEADER}\n,A,,DNF,,\n,B,,dq,,\n,C,,DNS,,`, 'CSV');

    expect(rows.map((row) => [row.resultStatus, row.finishPosition])).toEqual([
      [RaceResultStatus.DID_NOT_FINISH, null],
      [RaceResultStatus.DISQUALIFIED, null],
      [RaceResultStatus.DID_NOT_START, null],
    ]);
  });

  it('accepts the full status name with spaces or hyphens, so "did-not-finish" reads as did not finish', () => {
    const rows = parseRaceResultUpload(`${HEADER}\n,A,,did-not-finish,,`, 'CSV');

    expect(rows[0]?.resultStatus).toBe(RaceResultStatus.DID_NOT_FINISH);
  });

  it('rejects text with no place or status on any row, naming what is missing', () => {
    expect(() => parseRaceResultUpload(`${HEADER}\n,Sovereignty,,,,`, 'CSV')).toThrow(
      'No row has a finishing place or a result status.',
    );
  });

  it('rejects a place below 1 and names the row and column', () => {
    expect(() => parseRaceResultUpload(`${HEADER}\n,A,1,,,\n,B,0,,,`, 'CSV')).toThrow(
      'Row 2 (finishPosition): must be 1 or more.',
    );
  });

  it('rejects an unknown result status and lists the ones it takes', () => {
    expect(() => parseRaceResultUpload(`${HEADER}\n,A,,SCRATCHED,,`, 'CSV')).toThrow(
      'Row 1 (resultStatus): must be FINISHED, DNF, DQ or DNS.',
    );
  });

  it('rejects a row that names no runner', () => {
    expect(() => parseRaceResultUpload(`${HEADER}\n,,1,,,`, 'CSV')).toThrow(
      'Row 1: each row needs a participantId, externalId or playerName.',
    );
  });
});

describe('raceResultTemplateRows', () => {
  it('lists every runner with its place and status blank and its stored post position and rider filled in', () => {
    const rows = raceResultTemplateRows([
      fieldEntryFixture({
        participant: participantFixture({ name: 'Sovereignty', externalId: 'h-1' }),
        race: { finishPosition: 1, startPosition: 4, resultStatus: 'FINISHED', isOfficial: false, riderName: 'J. Alvarado' },
      }),
      fieldEntryFixture({ participant: participantFixture({ name: 'Journalism', externalId: undefined }) }),
    ]);

    expect(rows).toEqual([
      ['h-1', 'Sovereignty', '', '', '4', 'J. Alvarado'],
      ['', 'Journalism', '', '', '', ''],
    ]);
  });
});

describe('formatOrdinal', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [111, '111th'],
  ])('writes place %i as "%s"', (place, expected) => {
    expect(formatOrdinal(place)).toBe(expected);
  });
});

describe('describeRaceResult', () => {
  it('reads a finisher as its place, post position and rider', () => {
    expect(describeRaceResult({
      resultStatus: 'FINISHED', finishPosition: 2, startPosition: 7, riderName: 'I. Ortiz Jr.', isOfficial: false,
    })).toBe('2nd · start 7 · I. Ortiz Jr.');
  });

  it('reads a runner that did not finish by how its race ended, leaving out what is unknown', () => {
    expect(describeRaceResult({
      resultStatus: 'DID_NOT_FINISH', finishPosition: null, startPosition: null, riderName: null, isOfficial: true,
    })).toBe('Did not finish');
  });

  it('reads no stored result as a dash', () => {
    expect(describeRaceResult(null)).toBe('—');
  });
});
