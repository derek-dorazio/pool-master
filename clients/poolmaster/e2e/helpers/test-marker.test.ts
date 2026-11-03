import { describe, expect, it } from 'vitest';
import {
  e2eEmail,
  e2eLeagueCode,
  e2eName,
  e2eUsername,
  isRunOlderThan,
  newRunId,
  runIdOfLeagueCode,
  runIdOfName,
  runIdOfUser,
  runStartedAt,
} from './test-marker';
import { assertSweepableBaseUrl } from './residue-sweep';

// #1401 — the marker the e2e specs name their data with, and the matcher the QA residue sweep
// finds it by. A name the matcher misses stays on QA forever; a real name it matches is deleted.

const STARTED = new Date('2026-11-02T08:00:00.000Z');
const HOUR = 60 * 60 * 1000;

describe('the e2e test-name marker', () => {
  const runId = newRunId(STARTED);

  it('makes a run id from the start time and four hex characters, and reads the start time back', () => {
    expect(runId).toMatch(/^[0-9a-z]{8}[0-9a-f]{4}$/);
    expect(runStartedAt(runId)).toEqual(STARTED);
  });

  it('matches every name the specs make with the run id, whatever the label or a player number after it', () => {
    for (const label of ['Tour', 'Golfer', 'Open', 'Pickem Week 2', 'Squares Pool League', 'Playoff League']) {
      expect(runIdOfName(e2eName(label, runId))).toBe(runId);
    }
    expect(runIdOfName(`${e2eName('Golfer', runId)} 3`)).toBe(runId);
    expect(runIdOfName(`${e2eName('Team', runId)} Las Vegas Aces`)).toBe(runId);
  });

  it('matches a spec\'s users only when username and email carry the same run id at the e2e domain', () => {
    expect(runIdOfUser({ username: e2eUsername('c', runId), email: e2eEmail('c', runId) })).toBe(runId);
    expect(runIdOfUser({ username: e2eUsername('so', runId), email: e2eEmail('so', runId).toUpperCase() })).toBe(runId);
    expect(runIdOfUser({ username: e2eUsername('c', runId), email: `e2e-c-${runId}@example.com` })).toBeNull();
    expect(runIdOfUser({ username: e2eUsername('c', runId), email: e2eEmail('m', newRunId(STARTED)) })).toBeNull();
  });

  it('reads the run id back from every league code shape the specs use', () => {
    for (const letter of ['', 'B', 'K', 'P', 'R', 'S']) {
      expect(runIdOfLeagueCode(e2eLeagueCode(letter, runId))).toBe(runId);
    }
  });

  it('rejects real-looking names, users and codes that carry no run id', () => {
    for (const name of ['PGA Tour', 'E2E', 'E2E Tour', 'E2E Sports Club', 'The E2E Open 2026', `Tour ${runId}`, 'E2E Golfer 3']) {
      expect(runIdOfName(name)).toBeNull();
    }
    // The suite's own root admin has an e2e address but no run id.
    expect(runIdOfUser({ username: 'e2e-ci-admin', email: 'e2e-ci-admin@e2e.invalid' })).toBeNull();
    expect(runIdOfUser({ username: 'derek', email: 'derek@example.com' })).toBeNull();
    for (const code of ['QACHAMPION', 'E2E', 'E2EB', 'E2EBMHX', 'OFFICE2026']) {
      expect(runIdOfLeagueCode(code)).toBeNull();
    }
  });
});

describe('the residue sweep\'s age cutoff and target', () => {
  const runId = newRunId(STARTED);

  it('leaves a run younger than the cutoff alone and takes one at or past it', () => {
    expect(isRunOlderThan(runId, 2 * HOUR, new Date(STARTED.getTime() + 2 * HOUR - 1))).toBe(false);
    expect(isRunOlderThan(runId, 2 * HOUR, new Date(STARTED.getTime() + 2 * HOUR))).toBe(true);
    expect(isRunOlderThan(runId, 0, STARTED)).toBe(true);
  });

  it('runs against QA or a local stack and refuses every other site', () => {
    expect(() => assertSweepableBaseUrl('https://qa.ultimateofficepoolmanager.com')).not.toThrow();
    expect(() => assertSweepableBaseUrl('http://localhost:4175')).not.toThrow();
    expect(() => assertSweepableBaseUrl('http://127.0.0.1:4175')).not.toThrow();
    expect(() => assertSweepableBaseUrl('https://primetimecommissioner.com')).toThrow(/only against QA/);
    expect(() => assertSweepableBaseUrl('https://stage.ultimateofficepoolmanager.com')).toThrow(/only against QA/);
  });
});
