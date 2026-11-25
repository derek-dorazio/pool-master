import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { listedEntries } from './check-baseline-ratchet.mjs';
import { compareWithBaseline, ratchetBaseline, readBaseline, schemaEntries } from './check-schema-shapes.mjs';

const schema = (body) => body.join('\n');

describe('check-schema-shapes (#2112)', () => {
  it('reports every Json column, required or optional, and leaves typed columns alone', () => {
    const entries = schemaEntries(schema([
      'model Contest {',
      '  id       String @id',
      '  settings Json',
      '  extra    Json?  @map("extra")',
      '  name     String',
      '}',
    ]));
    assert.deepEqual(entries, ['json:Contest.settings', 'json:Contest.extra']);
  });

  it('fails a new Json column the baseline does not list, and asks to drop a listed one that is gone', () => {
    const entries = ['json:Contest.settings', 'json:Contest.extra'];
    const { unlisted, gone } = compareWithBaseline(entries, { 'json:Contest.settings': '#1', 'json:Old.blob': 'allowed: audit' });
    assert.deepEqual(unlisted, ['json:Contest.extra']);
    assert.deepEqual(gone, ['json:Old.blob']);
  });

  it('passes a feed key on a mapping table or a provider list, and reports one on any other model', () => {
    const entries = schemaEntries(schema([
      'model SportEventProviderMapping {',
      '  externalId String',
      '}',
      'model ProviderLeague {',
      '  providerLeagueId String',
      '}',
      'model ProviderSyncFinding {',
      '  providerValue String?',
      '}',
      'model SportEventRoundMatch {',
      '  externalGameId String?',
      '  providerKey    String',
      '}',
    ]));
    assert.deepEqual(entries, ['key:SportEventRoundMatch.externalGameId', 'key:SportEventRoundMatch.providerKey']);
  });

  it('passes a providerId that is the foreign key of a relation to Provider, and reports one that is not', () => {
    const entries = schemaEntries(schema([
      'model BackgroundJob {',
      '  providerId String? @db.Uuid',
      '  provider   Provider? @relation(fields: [providerId], references: [id], onDelete: Cascade)',
      '}',
      'model EmailMessage {',
      '  providerMessageId String?',
      '}',
    ]));
    assert.deepEqual(entries, ['key:EmailMessage.providerMessageId']);
  });

  it('only removes entries on update, keeping the reasons, and never adds one', () => {
    const { listed } = readBaseline(JSON.stringify({ $comment: 'c', 'json:A.x': '#1', 'json:B.y': 'allowed: audit' }));
    assert.deepEqual(ratchetBaseline(['json:A.x', 'json:New.z'], listed), { 'json:A.x': '#1' });
  });

  it('counts each listed column as one for the baseline ratchet, so a new column is a raise', () => {
    assert.deepEqual([...listedEntries(JSON.stringify({ $comment: 'c', 'json:A.x': '#1', 'key:B.y': 'allowed' }))], [['json:A.x', 1], ['key:B.y', 1]]);
  });
});
