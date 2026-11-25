import { describe, expect, it } from 'vitest';
import type { ParticipantRoundStatus } from '@poolmaster/shared/domain';
import {
  formatSportEventStatus,
  sportEventStatusTone,
  parseGolfRoundScoreUpload,
  golfRoundScoreRows,
  participantStatusTone,
} from './sport-admin-utils';
import { fieldEntryFixture, participantFixture } from './sport-test-fixtures';

// plans/124 §6.3/§6.4 — pure helpers backing the golf admin keystone screens (pool-master-3dg).

describe('pool-master-3dg sport-admin-utils: status formatting', () => {
  it('an event status reads its display string, sentence case like every other status', () => {
    expect(formatSportEventStatus('IN_PROGRESS')).toBe('In progress');
    expect(formatSportEventStatus('SCHEDULED')).toBe('Scheduled');
  });

  it('pool-master-3dg tones live, completed, and warning statuses distinctly', () => {
    expect(sportEventStatusTone('IN_PROGRESS')).toBe('live');
    expect(sportEventStatusTone('COMPLETED')).toBe('completed');
    expect(sportEventStatusTone('CANCELLED')).toBe('warning');
    expect(sportEventStatusTone('POSTPONED')).toBe('warning');
    expect(sportEventStatusTone('SCHEDULED')).toBe('neutral');
  });
});


describe('pool-master-r11 sport-admin-utils: parseGolfRoundScoreUpload', () => {
  it('pool-master-r11 parses CSV rows and upper-cases the status enum', () => {
    const rows = parseGolfRoundScoreUpload(
      'externalId,playerName,strokes,scoreToPar,thru,status\next-1,Rory McIlroy,70,-2,18,completed\n,Scottie Scheffler,68,-4,18,COMPLETED',
      'CSV',
    );
    expect(rows).toEqual([
      { externalId: 'ext-1', playerName: 'Rory McIlroy', strokes: 70, scoreToPar: -2, thru: 18, status: 'COMPLETED' },
      { playerName: 'Scottie Scheffler', strokes: 68, scoreToPar: -4, thru: 18, status: 'COMPLETED' },
    ]);
  });

  it('pool-master-r11 parses a JSON array with participantId and omitted thru', () => {
    expect(
      parseGolfRoundScoreUpload(
        '[{"participantId":"p-1","strokes":71,"scoreToPar":-1,"status":"IN_PROGRESS"}]',
        'JSON',
      ),
    ).toEqual([
      { participantId: 'p-1', strokes: 71, scoreToPar: -1, status: 'IN_PROGRESS' },
    ]);
  });

  it('pool-master-r11 rejects an unknown status', () => {
    expect(() =>
      parseGolfRoundScoreUpload(
        'playerName,strokes,scoreToPar,status\nRory McIlroy,70,-2,FINISHED',
        'CSV',
      ),
    ).toThrow(/Row 1 \(status\)/);
  });

  it('pool-master-r11 rejects a row with no identifier and a non-integer strokes', () => {
    expect(() =>
      parseGolfRoundScoreUpload(
        'externalId,playerName,strokes,scoreToPar,status\n,,70.5,-2,COMPLETED',
        'CSV',
      ),
    ).toThrow(/Row 1/);
  });

  it('pool-master-r11 rejects a thru outside 0-18', () => {
    expect(() =>
      parseGolfRoundScoreUpload(
        'playerName,strokes,scoreToPar,thru,status\nRory McIlroy,70,-2,25,COMPLETED',
        'CSV',
      ),
    ).toThrow(/Row 1 \(thru\)/);
  });

  it('rejects a row with 0 strokes, since a stored round has at least one stroke', () => {
    expect(() =>
      parseGolfRoundScoreUpload(
        'playerName,strokes,scoreToPar,thru,status\nRory McIlroy,0,-2,18,COMPLETED',
        'CSV',
      ),
    ).toThrow(/Row 1 \(strokes\)/);
  });

  it('pool-master-r11 skips template rows left with no score, keeping only the scored ones', () => {
    const rows = parseGolfRoundScoreUpload(
      'externalId,playerName,strokes,scoreToPar,thru,status\n,Rory McIlroy,,,,\n,Scottie Scheffler,68,-4,18,COMPLETED\n,Jon Rahm,,,,',
      'CSV',
    );
    expect(rows).toEqual([
      { playerName: 'Scottie Scheffler', strokes: 68, scoreToPar: -4, thru: 18, status: 'COMPLETED' },
    ]);
  });

  it('pool-master-r11 throws when every row is left blank', () => {
    expect(() =>
      parseGolfRoundScoreUpload(
        'externalId,playerName,strokes,scoreToPar,thru,status\n,Rory McIlroy,,,,\n,Jon Rahm,,,,',
        'CSV',
      ),
    ).toThrow('No scores were entered on any row.');
  });
});

describe('sport-admin-utils: golfRoundScoreRows (issue 236)', () => {
  function result(roundNumber: number, strokes: number, status: ParticipantRoundStatus = 'COMPLETED') {
    return {
      id: `r-${roundNumber}`,
      sportEventRoundId: `round-${roundNumber}`,
      roundNumber,
      status,
      completedAt: null,
      golf: { strokes, scoreToPar: strokes - 71, thru: 18 },
    };
  }

  it('takes the golfers with a golf result in the chosen round, sorted by name', () => {
    const field = [
      fieldEntryFixture({
        id: 'sep-z',
        participant: participantFixture({ name: 'Zach' }),
        rounds: [result(1, 70), result(2, 72, 'IN_PROGRESS')],
      }),
      fieldEntryFixture({ id: 'sep-a', participant: participantFixture({ name: 'Adam' }), rounds: [result(2, 69)] }),
      fieldEntryFixture({ id: 'sep-none', participant: participantFixture({ name: 'Nobody' }), rounds: [] }),
    ];

    expect(golfRoundScoreRows(field, 2)).toEqual([
      { sportEventParticipantId: 'sep-a', participantName: 'Adam', strokes: 69, scoreToPar: -2, thru: 18, status: 'COMPLETED', completedAt: null },
      { sportEventParticipantId: 'sep-z', participantName: 'Zach', strokes: 72, scoreToPar: 1, thru: 18, status: 'IN_PROGRESS', completedAt: null },
    ]);
    expect(golfRoundScoreRows(field, 4)).toEqual([]);
  });

  it('skips a round row that carries no golf result', () => {
    const field = [
      fieldEntryFixture({ rounds: [{ ...result(1, 70), golf: null }] }),
    ];
    expect(golfRoundScoreRows(field, 1)).toEqual([]);
  });
});

describe('sport-admin-utils: participantStatusTone', () => {
  it('tones an active participant active, a suspended one as a warning, and any other inactive', () => {
    expect(participantStatusTone('ACTIVE')).toBe('active');
    expect(participantStatusTone('SUSPENDED')).toBe('warning');
    expect(participantStatusTone('INACTIVE')).toBe('inactive');
  });
});

describe('sport-admin-utils: parseGolfRoundScoreUpload with no rows', () => {
  it('refuses an empty JSON array as having no rows', () => {
    expect(() => parseGolfRoundScoreUpload('[]', 'JSON')).toThrow('No rows found.');
  });
});
