import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'write-version-info.mjs');

/** Runs the generator with only the variables named here, so nothing leaks in from the shell. */
function run(env) {
  const outDir = mkdtempSync(path.join(tmpdir(), 'version-info-'));
  const result = spawnSync(process.execPath, [SCRIPT, '--out-dir', outDir], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
  return { result, outFile: path.join(outDir, 'version-info.json') };
}

describe('write-version-info (#180)', () => {
  it('writes the build identity CI supplies, exactly as supplied', () => {
    const { result, outFile } = run({
      POOLMASTER_SERVICE_VERSION: 'abc123',
      POOLMASTER_SERVICE_GIT_SHA: 'abc123def',
      POOLMASTER_BUILD_NUMBER: '42',
      POOLMASTER_BUILD_TIME_UTC: '2026-10-09T02:00:00.000Z',
      POOLMASTER_GIT_REF: 'main',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(readFileSync(outFile, 'utf8')), {
      schemaVersion: 1,
      buildTimeUtc: '2026-10-09T02:00:00.000Z',
      gitRef: 'main',
      service: {
        name: '@poolmaster/core-api',
        version: 'abc123',
        gitSha: 'abc123def',
        buildNumber: '42',
      },
    });
  });

  it('records the optional fields as null and stamps the build time when CI leaves them out', () => {
    const { result, outFile } = run({ POOLMASTER_SERVICE_VERSION: '0.0.0-local' });
    assert.equal(result.status, 0, result.stderr);
    const info = JSON.parse(readFileSync(outFile, 'utf8'));
    assert.equal(info.gitRef, null);
    assert.equal(info.service.gitSha, null);
    assert.equal(info.service.buildNumber, null);
    assert.ok(!Number.isNaN(Date.parse(info.buildTimeUtc)), 'buildTimeUtc is an ISO timestamp');
  });

  it('fails the build when no service version is supplied, instead of writing a made-up one', () => {
    const { result } = run({ GITHUB_SHA: 'ignored', RELEASE_VERSION: 'ignored' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /POOLMASTER_SERVICE_VERSION is required/);
  });

  it('writes next to package.json by default, where the core-api readers look for it', () => {
    const output = execFileSync(process.execPath, [SCRIPT, '--print-default-path'], { encoding: 'utf8' });
    assert.equal(output.trim(), path.resolve(path.dirname(SCRIPT), '..', 'version-info.json'));
  });
});
