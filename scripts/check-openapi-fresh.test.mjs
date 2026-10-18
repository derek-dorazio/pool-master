import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runStep, withTimeout } from './check-openapi-fresh.mjs';

// On 2026-10-18 the hey-api generator printed "Done!" and then never exited, twice. The job
// sat in api:check until its 10-minute limit with nothing in the log to say which step hung.
describe('check-openapi-fresh step limits', () => {
  it('fails a command that never exits once its time limit passes, naming the command', () => {
    const started = Date.now();
    assert.throws(
      () => runStep('node', ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 500 }),
      /node -e .* did not finish within 0\.5s/,
    );
    assert.ok(Date.now() - started < 5000, 'the hung command was not stopped at its limit');
  });

  it('fails a command that exits non-zero with its exit code', () => {
    assert.throws(
      () => runStep('node', ['-e', 'process.exit(3)'], { timeoutMs: 10_000 }),
      /failed with exit code 3/,
    );
  });

  it('rejects a step that never settles once its time limit passes, naming the step', async () => {
    await assert.rejects(
      withTimeout(new Promise(() => {}), 200, 'hey-api client generation'),
      /hey-api client generation did not finish within 0\.2s/,
    );
  });

  it('passes through the value of a step that finishes in time', async () => {
    assert.equal(await withTimeout(Promise.resolve('generated'), 1000, 'generation'), 'generated');
  });
});
