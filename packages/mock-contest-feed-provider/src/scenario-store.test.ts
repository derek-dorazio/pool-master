import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildApp } from './app';
import { ScenarioStore } from './scenario-store';

const scenarioDir = resolve(process.cwd(), 'contest-feed-scenarios');

test('ScenarioStore loads event-first scenarios and exposes field snapshots', () => {
  const store = new ScenarioStore(scenarioDir);

  const scenarios = store.listScenarios();
  assert.ok(scenarios.length >= 4);

  const golfScenario = store.getScenario('golf-major-2026');
  assert.equal(golfScenario.season.year, 2026);
  assert.equal(golfScenario.events[0]?.field.status, 'announced');

  const fieldSnapshot = store.getSnapshot('golf-major-2026', 'golf-masters-2026', 'field');
  assert.equal(fieldSnapshot.feedKind, 'field');
  assert.equal(fieldSnapshot.contestants[0]?.name, 'Avery Hart');

  const resultUpdates = store.getUpdates('golf-major-2026', 'golf-masters-2026');
  assert.equal(resultUpdates.updates[0]?.feedKind, 'field');
  assert.equal(resultUpdates.updates[1]?.feedKind, 'odds');
  assert.equal(resultUpdates.updates[2]?.feedKind, 'results');
});

test('ScenarioStore rejects new contestants in deltas unless they include a name', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'mock-feed-scenario-'));

  try {
    writeFileSync(
      join(tempDir, 'invalid.json'),
      JSON.stringify({
        scenarioId: 'invalid-scenario',
        sport: 'GOLF',
        provider: 'mock-contest-feed',
        season: {
          seasonId: 'invalid-2026',
          name: 'Invalid Season',
          year: 2026,
        },
        events: [
          {
            eventId: 'invalid-event',
            name: 'Invalid Event',
            status: 'scheduled',
            schedule: {
              startsAt: '2026-04-10T15:00:00.000Z',
            },
            field: {
              asOf: '2026-04-01T12:00:00.000Z',
              status: 'announced',
              contestants: [{ contestantId: 'golfer-01', name: 'Known Player' }],
            },
            feeds: {
              odds: {
                asOf: '2026-04-01T12:00:00.000Z',
                contestants: [{ contestantId: 'golfer-02', odds: 11.5 }],
              },
              rankings: {
                asOf: '2026-04-01T12:00:00.000Z',
                contestants: [],
              },
              results: {
                asOf: '2026-04-14T12:00:00.000Z',
                contestants: [],
              },
            },
          },
        ],
      }),
    );

    assert.throws(
      () => new ScenarioStore(tempDir),
      /must include name when introducing a new contestant/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('routes expose detail and field endpoints', async () => {
  const previousScenarioDir = process.env.SCENARIO_DIR;
  process.env.SCENARIO_DIR = scenarioDir;

  const app = buildApp();

  try {
    const detailResponse = await app.inject({
      method: 'GET',
      url: '/v1/scenarios/golf-major-2026/events/golf-masters-2026/detail',
    });
    assert.equal(detailResponse.statusCode, 200);
    const detailJson = detailResponse.json();
    assert.equal(detailJson.season.seasonId, 'golf-2026-majors');
    assert.equal(detailJson.event.schedule.fieldLocksAt, '2026-04-09T16:00:00.000Z');

    const fieldResponse = await app.inject({
      method: 'GET',
      url: '/v1/scenarios/golf-major-2026/events/golf-masters-2026/field',
    });
    assert.equal(fieldResponse.statusCode, 200);
    const fieldJson = fieldResponse.json();
    assert.equal(fieldJson.feedKind, 'field');
    assert.equal(fieldJson.contestants.length, 8);
  } finally {
    await app.close();
    if (previousScenarioDir === undefined) {
      delete process.env.SCENARIO_DIR;
    } else {
      process.env.SCENARIO_DIR = previousScenarioDir;
    }
  }
});
