import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { ScenarioStore } from './scenario-store';
import { loadTourSeedScenarios } from './tour-seeds';

/* eslint-disable @typescript-eslint/no-floating-promises --
 * node:test registers top-level tests unawaited; see scenario-store.test.ts for why these
 * are not prefixed with `void`. */

const scenarioDir = resolve(process.cwd(), 'contest-feed-scenarios');
const minuteMs = 60 * 1000;

function storeAt(now: Date): ScenarioStore {
  return new ScenarioStore(scenarioDir, undefined, { now: () => now });
}

test('the mock lists each tour season as its own golf scenario: PGA TOUR and LPGA Tour for 2026 and 2027', () => {
  const store = storeAt(new Date('2026-10-06T12:00:00.000Z'));
  const seasons = store.listScenarios().filter((scenario) => /^(pga|lpga)-tour-\d{4}$/.test(scenario.scenarioId));

  assert.deepEqual(
    seasons.map((scenario) => [scenario.scenarioId, scenario.sport, scenario.seasonYear]),
    [
      ['lpga-tour-2026', 'GOLF', 2026],
      ['lpga-tour-2027', 'GOLF', 2027],
      ['pga-tour-2026', 'GOLF', 2026],
      ['pga-tour-2027', 'GOLF', 2027],
    ],
  );
  assert.equal(store.listEvents('pga-tour-2026').length, 45);
  assert.equal(store.listEvents('lpga-tour-2026').length, 31);
  assert.ok(store.listEvents('pga-tour-2027').length >= 34);
  assert.ok(store.listEvents('lpga-tour-2027').length >= 31);
});

test('every seeded event has a stable tour-season id, falls in its season, and carries its tour', () => {
  const store = storeAt(new Date('2026-10-06T12:00:00.000Z'));
  const seen = new Set<string>();

  for (const scenarioId of ['pga-tour-2026', 'pga-tour-2027', 'lpga-tour-2026', 'lpga-tour-2027']) {
    const year = Number(scenarioId.slice(-4));
    for (const summary of store.listEvents(scenarioId)) {
      assert.match(summary.eventId, new RegExp(`^${scenarioId}-[a-z0-9-]+$`));
      assert.ok(!seen.has(summary.eventId), `${summary.eventId} is unique across seasons`);
      seen.add(summary.eventId);
      assert.equal(new Date(summary.startsAt).getUTCFullYear(), year);
      assert.ok(summary.endsAt && summary.endsAt > summary.startsAt);
      const event = store.getEvent(scenarioId, summary.eventId);
      assert.equal(event.metadata?.tour, scenarioId.startsWith('lpga') ? 'LPGA Tour' : 'PGA TOUR');
      assert.equal(event.status, 'scheduled');
    }
  }
});

test('a seeded event\'s field is its own tour\'s ranked players, best-ranked first, never the other tour\'s', () => {
  const store = storeAt(new Date('2026-10-06T12:00:00.000Z'));
  const masters = store.getSnapshot('pga-tour-2026', 'pga-tour-2026-masters-tournament', 'field').contestants;
  const chevron = store.getSnapshot('lpga-tour-2026', 'lpga-tour-2026-the-chevron-championship', 'field').contestants;

  assert.equal(masters[0]?.name, 'Scottie Scheffler');
  assert.equal(masters[0]?.seed, 1);
  assert.equal(chevron[0]?.name, 'Nelly Korda');
  assert.ok(masters.length >= 150 && chevron.length >= 140);
  assert.ok(masters.every((golfer) => golfer.contestantId.startsWith('pga-tour-')));
  assert.ok(chevron.every((golfer) => golfer.contestantId.startsWith('lpga-tour-')));
  const rankings = masters.map((golfer) => golfer.seed ?? 0);
  assert.deepEqual(rankings, [...rankings].sort((left, right) => left - right));
});

test('seeded events read the same whatever today is', () => {
  const eventId = 'lpga-tour-2027-the-chevron-championship';
  assert.deepEqual(
    storeAt(new Date('2026-01-05T09:00:00.000Z')).getEvent('lpga-tour-2027', eventId),
    storeAt(new Date('2028-07-17T21:00:00.000Z')).getEvent('lpga-tour-2027', eventId),
  );
});

test('a live replay on a seeded LPGA event scores that event\'s LPGA field and moves between polls', () => {
  const start = new Date('2026-10-06T12:00:00.000Z');
  let now = start;
  const store = new ScenarioStore(scenarioDir, undefined, { now: () => now });
  const eventId = 'lpga-tour-2026-the-chevron-championship';

  store.startLiveReplay('lpga-tour-2026', eventId, {});
  now = new Date(start.getTime() + 8 * minuteMs);
  const first = store.getLiveScores('lpga-tour-2026', eventId);
  now = new Date(start.getTime() + 14 * minuteMs);
  const second = store.getLiveScores('lpga-tour-2026', eventId);

  assert.ok(first.contestants.length > 0);
  assert.ok(second.contestants.every((golfer) => golfer.contestantId.startsWith('lpga-tour-')));
  assert.notDeepEqual(first.contestants, second.contestants);
});

test('a tour season whose tour has no player list is refused when the mock loads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tour-seeds-'));
  try {
    mkdirSync(join(dir, 'tours'));
    writeFileSync(join(dir, 'tours', 'demo-tour-2026.json'), JSON.stringify({
      tour: 'Demo', tourId: 'demo-tour', season: 2026, published: 'published', events: [],
    }));
    assert.throws(() => loadTourSeedScenarios(dir), /no demo-tour-players.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a tour season with an event ending before it starts is refused when the mock loads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tour-seeds-'));
  try {
    mkdirSync(join(dir, 'tours'));
    writeFileSync(join(dir, 'tours', 'demo-tour-players.json'), JSON.stringify({
      tour: 'Demo', tourId: 'demo-tour', players: [{ playerId: 'demo-a', name: 'A', ranking: 1 }],
    }));
    writeFileSync(join(dir, 'tours', 'demo-tour-2026.json'), JSON.stringify({
      tour: 'Demo', tourId: 'demo-tour', season: 2026, published: 'published',
      events: [{ eventId: 'demo-tour-2026-open', name: 'Open', startDate: '2026-05-10', endDate: '2026-05-07', rounds: 4 }],
    }));
    assert.throws(() => loadTourSeedScenarios(dir), /startDate <= endDate/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
