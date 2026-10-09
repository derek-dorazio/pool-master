/**
 * #180 — the running build's identity comes from one file, `version-info.json`, written at
 * build time by `packages/core-api/scripts/write-version-info.mjs`. These readers have no
 * fallback: a build that cannot say what it is must not start claiming `0.1.0`.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readVersionInfoFile } from '../../../packages/core-api/src/core/version-info';

function fileWith(content: string): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'version-info-')), 'version-info.json');
  writeFileSync(file, content, 'utf8');
  return file;
}

const VALID = {
  schemaVersion: 1,
  buildTimeUtc: '2026-10-09T02:00:00.000Z',
  gitRef: 'main',
  service: { name: '@poolmaster/core-api', version: 'abc123', gitSha: 'abc123', buildNumber: '42' },
};

describe('readVersionInfoFile', () => {
  it('returns the build identity the file records', () => {
    expect(readVersionInfoFile(fileWith(JSON.stringify(VALID)))).toEqual(VALID);
  });

  it('throws naming the file when it is missing, so a build without one cannot start', () => {
    expect(() => readVersionInfoFile('/nonexistent/version-info.json')).toThrow(
      /\/nonexistent\/version-info\.json.*write-version-info/s,
    );
  });

  it('throws when the file does not match the version-info shape', () => {
    expect(() => readVersionInfoFile(fileWith(JSON.stringify({ ...VALID, service: { name: 'x' } })))).toThrow(
      /is not a valid version-info file/,
    );
  });
});
