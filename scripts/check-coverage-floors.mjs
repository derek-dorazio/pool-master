// #1483 -- checks per-file coverage floors against one merged istanbul report. It runs no tests.
//
// CI's integration suite runs in four shards. `jest --shard` measures every source file in every
// shard, so a repository whose tests ran in another shard shows a few percent there, and Jest's
// own per-file `coverageThreshold` would fail every shard. The true per-file number only exists
// once the shard reports are merged (scripts/merge-service-coverage.mjs), and this script checks
// that merged report.
//
// The floors live in a config file: one entry per area, a glob relative to the root (`include`,
// with optional `exclude` globs), a lines and a branches percentage, and named exceptions with a
// reason. Every file the glob matches must reach both floors. A floor whose glob matches no file
// in the report fails too, so a moved folder or a report with unexpected paths cannot pass by
// checking nothing. Three configs (#2103):
//   scripts/coverage-floors.json         the merged integration report (repositories)
//   scripts/coverage-floors-merged.json  unit + integration merged: every backend file, and jobs
//   scripts/coverage-floors-web.json     the web app's Vitest report: every web file
//
// Exceptions only ever tighten (#2103). An exception is today's number rounded down, so a file
// that improves fails until its exception is raised to the new number, and one that reaches the
// floor fails until its exception is deleted. `rules:check:baseline-ratchet` refuses a new
// exception or a lowered floor unless scripts/baseline-raises.json declares it. `--suggest` prints
// the exceptions block a report implies, for a floor being introduced.
//
// CLI: node scripts/check-coverage-floors.mjs [--config <floors.json>] [--root <dir>] [--suggest] <coverage-final.json>  (USAGE)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import istanbulCoverage from 'istanbul-lib-coverage';

const { createCoverageMap } = istanbulCoverage;

export const DEFAULT_CONFIG = 'scripts/coverage-floors.json';
export const USAGE =
  'node scripts/check-coverage-floors.mjs [--config <floors.json>] [--root <dir>] [--suggest] <coverage-final.json>';

function toPosix(p) {
  return p.split(path.sep).join('/');
}

// Returns { results, failures, problems }. `results` holds one row per checked file, `failures`
// the rows under their floor, and `problems` config errors (a glob matching nothing, an exception
// with no reason or naming a file the glob does not cover).
export function checkCoverageFloors({ coverage, floors, root }) {
  const coverageMap = createCoverageMap(coverage);
  const files = coverageMap.files().map((absolute) => ({
    absolute,
    relative: toPosix(path.relative(root, absolute)),
  }));

  const results = [];
  const problems = [];

  for (const floor of floors) {
    const exceptions = floor.exceptions ?? {};
    const excluded = (file) => (floor.exclude ?? []).some((glob) => path.matchesGlob(file.relative, glob));
    const matched = files.filter((file) => path.matchesGlob(file.relative, floor.include) && !excluded(file));

    if (matched.length === 0) {
      problems.push(
        `Floor "${floor.name}" (${floor.include}) matched no file in the coverage report.`,
      );
    }

    for (const [file, exception] of Object.entries(exceptions)) {
      if (!exception.reason || exception.reason.trim() === '') {
        problems.push(`Exception for ${file} in floor "${floor.name}" has no reason.`);
      }
      if (!matched.some((m) => m.relative === file)) {
        problems.push(
          `Exception for ${file} in floor "${floor.name}" names a file the floor does not cover.`,
        );
      }
    }

    for (const file of matched) {
      const summary = coverageMap.fileCoverageFor(file.absolute).toSummary();
      const exception = exceptions[file.relative];
      const required = {
        lines: exception?.lines ?? floor.lines,
        branches: exception?.branches ?? floor.branches,
      };
      const actual = { lines: summary.lines.pct, branches: summary.branches.pct };
      const short = [];
      if (actual.lines < required.lines) short.push('lines');
      if (actual.branches < required.branches) short.push('branches');
      if (exception) {
        if (actual.lines >= floor.lines && actual.branches >= floor.branches) {
          problems.push(`${file.relative} now meets floor "${floor.name}" (${floor.lines} / ${floor.branches}); delete its exception.`);
        } else {
          for (const metric of ['lines', 'branches']) {
            const now = Math.min(Math.floor(actual[metric]), floor[metric]);
            if (exception[metric] !== undefined && now > exception[metric]) {
              problems.push(`${file.relative} has ${actual[metric]}% ${metric} in floor "${floor.name}"; raise its exception from ${exception[metric]} to ${now}.`);
            }
          }
        }
      }
      results.push({
        floor: floor.name,
        file: file.relative,
        actual,
        required,
        exception: Boolean(exception),
        short,
      });
    }
  }

  results.sort((a, b) => a.actual.lines - b.actual.lines || a.actual.branches - b.actual.branches);
  const failures = results.filter((r) => r.short.length > 0);
  return { results, failures, problems };
}

/**
 * The exceptions block a report implies for each floor: every file under the floor, at today's
 * numbers rounded down. Used once, when a floor is introduced; afterwards exceptions only rise.
 */
export function suggestExceptions({ results }, floors, reason) {
  const byFloor = Object.fromEntries(floors.map((floor) => [floor.name, {}]));
  for (const r of results) {
    const floor = floors.find((f) => f.name === r.floor);
    if (r.actual.lines >= floor.lines && r.actual.branches >= floor.branches) continue;
    const entry = { reason };
    if (r.actual.lines < floor.lines) entry.lines = Math.floor(r.actual.lines);
    if (r.actual.branches < floor.branches) entry.branches = Math.floor(r.actual.branches);
    byFloor[r.floor][r.file] = entry;
  }
  return byFloor;
}

export function formatMarkdown({ results, failures, problems }) {
  const lines = ['### Per-file coverage floors (#1483)', ''];
  if (problems.length > 0) {
    lines.push('**Configuration problems:**', '', ...problems.map((p) => `- ${p}`), '');
  }
  lines.push(
    failures.length === 0
      ? `All ${results.length} files meet their floor.`
      : `**${failures.length} of ${results.length} files are under their floor.**`,
    '',
    '| File | Lines | Branches | Floor (lines / branches) |',
    '|---|---:|---:|---|',
  );
  for (const r of results) {
    const mark = r.short.length > 0 ? ' ❌' : '';
    const floor = `${r.required.lines} / ${r.required.branches}${r.exception ? ' (exception)' : ''}`;
    lines.push(`| \`${r.file}\`${mark} | ${r.actual.lines}% | ${r.actual.branches}% | ${floor} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function parseArgs(argv) {
  let config = DEFAULT_CONFIG;
  let root = process.cwd();
  let suggest = false;
  const inputs = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--config' || argv[i] === '--root') {
      const value = argv[i + 1];
      if (value === undefined) return null;
      if (argv[i] === '--config') config = value;
      else root = path.resolve(value);
      i += 1;
    } else if (argv[i] === '--suggest') {
      suggest = true;
    } else {
      inputs.push(argv[i]);
    }
  }
  if (inputs.length !== 1) return null;
  return { config, root, suggest, input: inputs[0] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error(`Usage: ${USAGE}`);
    process.exit(1);
  }
  if (!fs.existsSync(args.input)) {
    console.error(`Coverage report not found: ${args.input}`);
    process.exit(1);
  }
  const coverage = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  const { floors } = JSON.parse(fs.readFileSync(args.config, 'utf8'));
  const outcome = checkCoverageFloors({ coverage, floors, root: args.root });
  if (args.suggest) {
    console.log(JSON.stringify(suggestExceptions(outcome, floors, 'Below the floor when it was introduced (#2103); raise as tests land.'), null, 2));
    process.exit(0);
  }
  const markdown = formatMarkdown(outcome);

  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }

  const inCi = process.env.GITHUB_ACTIONS === 'true';
  for (const problem of outcome.problems) {
    console.log(inCi ? `::error::${problem}` : `ERROR: ${problem}`);
  }
  for (const f of outcome.failures) {
    const detail = `${f.file}: lines ${f.actual.lines}% (floor ${f.required.lines}), branches ${f.actual.branches}% (floor ${f.required.branches})`;
    console.log(
      inCi ? `::error file=${f.file}::Under coverage floor -- ${detail}` : `UNDER FLOOR: ${detail}`,
    );
  }
  if (outcome.problems.length > 0 || outcome.failures.length > 0) {
    process.exit(1);
  }
}
