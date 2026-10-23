import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'ci-install-playwright-chromium.sh');

/**
 * The browser comes from the Actions cache, but `--with-deps` also asks apt for Playwright's
 * system packages, and on 2026-10-23 a slow Ubuntu mirror made that time out on four main
 * runs. The runner image already has every library Chromium links against, so apt should run
 * only when a library is really missing. These cases run the script against stub `npx`,
 * `sudo` and `ldd` commands that record how they were called.
 */
describe('ci-install-playwright-chromium', () => {
  let work;
  let calls;

  function stub(name, body) {
    const path = join(work, 'bin', name);
    writeFileSync(path, `#!/usr/bin/env bash\necho "${name} $*" >> "${calls}"\n${body}\n`);
    chmodSync(path, 0o755);
  }

  function run({ lddOutput, lddBody, browsers = ['chromium-1/chrome-linux64/chrome'] }) {
    for (const browser of browsers) {
      const path = join(work, 'browsers', browser);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '');
    }
    stub('ldd', lddBody ?? `printf '%s\\n' "${lddOutput}"`);
    return spawnSync('bash', [SCRIPT, '3', '30', '120'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(work, 'bin')}:${process.env.PATH}`,
        PLAYWRIGHT_BROWSERS_PATH: join(work, 'browsers'),
      },
    });
  }

  const recorded = () => readFileSync(calls, 'utf8').trim().split('\n');

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'pw-install-'));
    calls = join(work, 'calls.log');
    writeFileSync(calls, '');
    mkdirSync(join(work, 'bin'));
    mkdirSync(join(work, 'browsers'));
    stub('npx', 'exit 0');
    stub('sudo', 'cat > /dev/null; exit 0');
    stub('pgrep', 'exit 1');
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it('skips apt entirely when every library the browser links against is installed', () => {
    const result = run({ lddOutput: '\tlibnss3.so => /usr/lib/x86_64-linux-gnu/libnss3.so (0x1)' });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(recorded().filter((call) => !call.startsWith('ldd ')), [
      'npx playwright install chromium',
    ]);
  });

  it('installs the system packages when the browser is missing a library', () => {
    const result = run({ lddOutput: '\tlibgbm.so.1 => not found' });

    assert.equal(result.status, 0, result.stderr);
    assert.ok(recorded().includes('npx playwright install --with-deps chromium'));
  });

  it('installs the system packages when one of two browsers is missing a library and ldd fails on both', () => {
    const result = run({
      lddBody: 'case "$1" in *headless*) echo "\tlibx.so => not found";; esac\nexit 1',
      browsers: [
        'chromium-1/chrome-linux64/chrome',
        'chromium_headless_shell-1/chrome-headless-shell-linux64/chrome-headless-shell',
      ],
    });

    assert.equal(result.status, 0, result.stderr);
    assert.ok(recorded().includes('npx playwright install --with-deps chromium'));
  });

  it('installs the system packages when ldd cannot read a browser binary', () => {
    const result = run({ lddBody: 'echo "not a dynamic executable" >&2\nexit 1' });

    assert.equal(result.status, 0, result.stderr);
    assert.ok(recorded().includes('npx playwright install --with-deps chromium'));
  });

  it('installs the system packages when no browser binary can be found to check', () => {
    const result = run({ lddOutput: '', browsers: [] });

    assert.equal(result.status, 0, result.stderr);
    assert.ok(recorded().includes('npx playwright install --with-deps chromium'));
  });
});
