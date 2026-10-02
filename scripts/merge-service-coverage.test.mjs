import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { mergeServiceCoverage } from './merge-service-coverage.mjs';

// Minimal istanbul file coverage: one statement, hit `count` times.
function fileCoverage(filePath, count) {
  return {
    [filePath]: {
      path: filePath,
      statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } } },
      fnMap: {},
      branchMap: {},
      s: { 0: count },
      f: {},
      b: {},
    },
  };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-service-coverage-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function writeInput(name, coverage) {
  const filePath = path.join(tmp, name, 'coverage-final.json');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(coverage));
  return filePath;
}

describe('merge-service-coverage (#294)', () => {
  it('merges every input into one report, counting a file covered by any suite as covered', () => {
    const unit = writeInput('unit', { ...fileCoverage('/src/a.ts', 1), ...fileCoverage('/src/b.ts', 0) });
    const integration = writeInput('integration', fileCoverage('/src/b.ts', 2));
    const outDir = path.join(tmp, 'out-all');

    const result = mergeServiceCoverage({ inputs: [unit, integration], outDir });

    assert.deepEqual(result.merged, [unit, integration]);
    assert.deepEqual(result.missing, []);
    assert.equal(result.total.statements.total, 2);
    assert.equal(result.total.statements.covered, 2);
    for (const file of ['coverage-final.json', 'coverage-summary.json', 'lcov.info', 'clover.xml']) {
      assert.ok(fs.existsSync(path.join(outDir, file)), `${file} written`);
    }
  });

  it('merges the inputs that exist and reports the missing one, instead of throwing', () => {
    const unit = writeInput('unit-only', fileCoverage('/src/a.ts', 1));
    const absent = path.join(tmp, 'functional-api', 'coverage-final.json');

    const result = mergeServiceCoverage({ inputs: [unit, absent], outDir: path.join(tmp, 'out-partial') });

    assert.deepEqual(result.merged, [unit]);
    assert.deepEqual(result.missing, [absent]);
    assert.equal(result.total.statements.covered, 1);
  });

  it('writes nothing and returns no total when no input exists', () => {
    const outDir = path.join(tmp, 'out-none');

    const result = mergeServiceCoverage({ inputs: [path.join(tmp, 'nope.json')], outDir });

    assert.equal(result.total, null);
    assert.ok(!fs.existsSync(outDir));
  });
});
