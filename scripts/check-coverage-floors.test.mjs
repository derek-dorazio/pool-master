import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import { checkCoverageFloors, formatMarkdown } from './check-coverage-floors.mjs';
import { mergeServiceCoverage } from './merge-service-coverage.mjs';

const script = fileURLToPath(new URL('./check-coverage-floors.mjs', import.meta.url));
const root = '/repo';

// Istanbul file coverage with `total` statements (one per line) of which the first `hit` ran,
// and one if/else branch whose arms ran `branchHits` times.
function fileCoverage(relative, { total, hit, branchHits = null }) {
  const filePath = `${root}/${relative}`;
  const statementMap = {};
  const s = {};
  for (let i = 0; i < total; i += 1) {
    statementMap[i] = { start: { line: i + 1, column: 0 }, end: { line: i + 1, column: 10 } };
    s[i] = i < hit ? 1 : 0;
  }
  const branchMap = {};
  const b = {};
  if (branchHits) {
    const loc = { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } };
    branchMap[0] = { type: 'if', line: 1, loc, locations: [loc, loc] };
    b[0] = branchHits;
  }
  return { [filePath]: { path: filePath, statementMap, fnMap: {}, branchMap, s, f: {}, b } };
}

const repositories = (overrides = {}) => ({
  name: 'repositories',
  include: 'packages/core-api/src/adapters/**/*.ts',
  lines: 90,
  branches: 80,
  exceptions: {},
  ...overrides,
});

describe('check-coverage-floors (#1483)', () => {
  it('passes when every matched file reaches both the lines and the branches floor', () => {
    const coverage = fileCoverage('packages/core-api/src/adapters/a.ts', {
      total: 10,
      hit: 9,
      branchHits: [1, 1],
    });
    const outcome = checkCoverageFloors({ coverage, floors: [repositories()], root });
    assert.equal(outcome.failures.length, 0);
    assert.equal(outcome.problems.length, 0);
    assert.equal(outcome.results.length, 1);
  });

  it('fails a file under the lines floor and names lines as the shortfall', () => {
    const coverage = fileCoverage('packages/core-api/src/adapters/a.ts', { total: 10, hit: 8 });
    const { failures } = checkCoverageFloors({ coverage, floors: [repositories()], root });
    assert.deepEqual(
      failures.map((f) => [f.file, f.short]),
      [['packages/core-api/src/adapters/a.ts', ['lines']]],
    );
  });

  it('fails a file under the branches floor even when its lines are fully covered', () => {
    const coverage = fileCoverage('packages/core-api/src/adapters/a.ts', {
      total: 10,
      hit: 10,
      branchHits: [1, 0],
    });
    const { failures } = checkCoverageFloors({ coverage, floors: [repositories()], root });
    assert.deepEqual(failures[0].short, ['branches']);
  });

  it('ignores files outside the floor glob, however low their coverage', () => {
    const coverage = {
      ...fileCoverage('packages/core-api/src/adapters/a.ts', { total: 10, hit: 10 }),
      ...fileCoverage('packages/core-api/src/modules/b.ts', { total: 10, hit: 0 }),
    };
    const { results, failures } = checkCoverageFloors({ coverage, floors: [repositories()], root });
    assert.deepEqual(
      results.map((r) => r.file),
      ['packages/core-api/src/adapters/a.ts'],
    );
    assert.equal(failures.length, 0);
  });

  it('holds a named exception to its own lower floor instead of the default', () => {
    const coverage = fileCoverage('packages/core-api/src/adapters/a.ts', { total: 10, hit: 7 });
    const floors = [
      repositories({
        exceptions: {
          'packages/core-api/src/adapters/a.ts': { lines: 70, branches: 80, reason: 'x' },
        },
      }),
    ];
    const { failures, problems } = checkCoverageFloors({ coverage, floors, root });
    assert.equal(failures.length, 0);
    assert.equal(problems.length, 0);
  });

  it('reports an exception with no reason as a configuration problem', () => {
    const coverage = fileCoverage('packages/core-api/src/adapters/a.ts', { total: 10, hit: 10 });
    const floors = [
      repositories({ exceptions: { 'packages/core-api/src/adapters/a.ts': { lines: 70 } } }),
    ];
    const { problems } = checkCoverageFloors({ coverage, floors, root });
    assert.match(problems.join('\n'), /has no reason/);
  });

  it('reports an exception naming a file the floor does not cover, so stale exceptions surface', () => {
    const coverage = fileCoverage('packages/core-api/src/adapters/a.ts', { total: 10, hit: 10 });
    const floors = [
      repositories({
        exceptions: { 'packages/core-api/src/adapters/gone.ts': { lines: 70, reason: 'x' } },
      }),
    ];
    const { problems } = checkCoverageFloors({ coverage, floors, root });
    assert.match(problems.join('\n'), /does not cover/);
  });

  it('reports a floor whose glob matches no file, so a wrong path cannot pass by checking nothing', () => {
    const coverage = fileCoverage('packages/core-api/src/modules/b.ts', { total: 10, hit: 10 });
    const { problems } = checkCoverageFloors({ coverage, floors: [repositories()], root });
    assert.match(problems.join('\n'), /matched no file/);
  });

  it('judges the merged shard reports, so a file tested in another shard is not counted as uncovered', () => {
    // Shard 1 ran the tests for a.ts; shard 2 measured it but ran none of them.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-coverage-floors-'));
    after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const write = (name, coverage) => {
      const file = path.join(tmp, name, 'coverage-final.json');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(coverage));
      return file;
    };
    const shard1 = write(
      '1',
      fileCoverage('packages/core-api/src/adapters/a.ts', { total: 10, hit: 10 }),
    );
    const shard2 = write(
      '2',
      fileCoverage('packages/core-api/src/adapters/a.ts', { total: 10, hit: 1 }),
    );

    const alone = checkCoverageFloors({
      coverage: JSON.parse(fs.readFileSync(shard2, 'utf8')),
      floors: [repositories()],
      root,
    });
    assert.equal(alone.failures.length, 1);

    const outDir = path.join(tmp, 'merged');
    mergeServiceCoverage({ inputs: [shard1, shard2], outDir });
    const merged = JSON.parse(fs.readFileSync(path.join(outDir, 'coverage-final.json'), 'utf8'));
    assert.equal(
      checkCoverageFloors({ coverage: merged, floors: [repositories()], root }).failures.length,
      0,
    );
  });

  it('lists the lowest-covered files first in the markdown table and marks the ones under floor', () => {
    const coverage = {
      ...fileCoverage('packages/core-api/src/adapters/high.ts', { total: 10, hit: 10 }),
      ...fileCoverage('packages/core-api/src/adapters/low.ts', { total: 10, hit: 5 }),
    };
    const markdown = formatMarkdown(
      checkCoverageFloors({ coverage, floors: [repositories()], root }),
    );
    assert.ok(markdown.indexOf('low.ts') < markdown.indexOf('high.ts'));
    assert.match(markdown, /low\.ts` ❌/);
    assert.match(markdown, /1 of 2 files are under their floor/);
  });

  it('exits non-zero from the CLI when a file is under its floor, and zero when all pass', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-coverage-floors-cli-'));
    after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const config = path.join(tmp, 'floors.json');
    fs.writeFileSync(config, JSON.stringify({ floors: [repositories()] }));
    const run = (hit) => {
      const input = path.join(tmp, `cov-${hit}.json`);
      fs.writeFileSync(
        input,
        JSON.stringify(fileCoverage('packages/core-api/src/adapters/a.ts', { total: 10, hit })),
      );
      return spawnSync(process.execPath, [script, '--config', config, '--root', root, input], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_STEP_SUMMARY: '' },
      });
    };
    const failing = run(5);
    assert.equal(failing.status, 1);
    assert.match(failing.stdout, /UNDER FLOOR: packages\/core-api\/src\/adapters\/a\.ts/);
    assert.equal(run(10).status, 0);
  });

  it('keeps the committed repository floor at 90% lines and 80% branches over packages/core-api/src/adapters', () => {
    const config = JSON.parse(
      fs.readFileSync(fileURLToPath(new URL('./coverage-floors.json', import.meta.url)), 'utf8'),
    );
    const floor = config.floors.find((f) => f.name === 'repositories');
    assert.equal(floor.include, 'packages/core-api/src/adapters/**/*.ts');
    assert.equal(floor.lines, 90);
    assert.equal(floor.branches, 80);
  });
});
