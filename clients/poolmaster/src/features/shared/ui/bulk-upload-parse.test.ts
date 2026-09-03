import { describe, expect, it } from 'vitest';
import { parseDelimitedRecords } from './bulk-upload-parse';

// plans/124 §6.4 — the shared CSV/JSON tokeniser behind BulkUploadPanel.
// rule: format-level parse errors surface inline (react-ui-rules §7 honest states).
describe('parseDelimitedRecords', () => {
  it('parses CSV into header-keyed records, skipping blank cells and lines', () => {
    const text = 'externalId,playerName,worldRanking\ndj-1,Dustin Johnson,12\n\n,Rory McIlroy,3\n';
    expect(parseDelimitedRecords(text, 'CSV')).toEqual([
      { externalId: 'dj-1', playerName: 'Dustin Johnson', worldRanking: '12' },
      { playerName: 'Rory McIlroy', worldRanking: '3' },
    ]);
  });

  it('parses a JSON array of row objects', () => {
    const text = '[{"playerName":"Rory McIlroy","worldRanking":3}]';
    expect(parseDelimitedRecords(text, 'JSON')).toEqual([
      { playerName: 'Rory McIlroy', worldRanking: 3 },
    ]);
  });

  it('throws a user-facing error for empty input', () => {
    expect(() => parseDelimitedRecords('   ', 'CSV')).toThrow('Paste or upload some rows first.');
  });

  it('throws when CSV has only a header row', () => {
    expect(() => parseDelimitedRecords('externalId,playerName', 'CSV')).toThrow(
      'Add a header row and at least one data row.',
    );
  });

  it('throws for malformed JSON', () => {
    expect(() => parseDelimitedRecords('{not json', 'JSON')).toThrow('That is not valid JSON.');
  });

  it('throws when JSON is not an array', () => {
    expect(() => parseDelimitedRecords('{"playerName":"x"}', 'JSON')).toThrow(
      'JSON input must be an array of row objects.',
    );
  });

  it('throws when a JSON entry is not an object', () => {
    expect(() => parseDelimitedRecords('["Dustin Johnson"]', 'JSON')).toThrow(
      'Row 1 is not a JSON object.',
    );
  });
});
