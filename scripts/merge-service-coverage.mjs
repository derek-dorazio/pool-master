// #294 — merges per-suite service coverage into coverage/service-merged/. It runs no tests.
//
// CI runs each service suite in its own job and the advisory coverage-report job calls this
// on the downloaded artifacts; run-backend-coverage.mjs calls it after running the suites
// locally. A missing input is a warning, not an error: a suite that failed still leaves the
// others worth reporting. Only an empty merge (no inputs at all) fails.
//
// CLI: node scripts/merge-service-coverage.mjs [--out <dir>] [<coverage-final.json> ...]  (USAGE)
// With no inputs it reads the three default per-suite locations under coverage/.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import istanbulCoverage from 'istanbul-lib-coverage';
import istanbulReport from 'istanbul-lib-report';
import istanbulReports from 'istanbul-reports';

const { createCoverageMap } = istanbulCoverage;
const { createContext } = istanbulReport;

export const DEFAULT_INPUTS = [
  'coverage/service-unit/coverage-final.json',
  'coverage/service-integration/coverage-final.json',
  'coverage/service-functional-api/coverage-final.json',
];
export const DEFAULT_OUT_DIR = 'coverage/service-merged';
export const USAGE = 'node scripts/merge-service-coverage.mjs [--out <dir>] [<coverage-final.json> ...]';

export function mergeServiceCoverage({ inputs, outDir }) {
  const coverageMap = createCoverageMap({});
  const merged = [];
  const missing = [];

  for (const input of inputs) {
    if (!fs.existsSync(input)) {
      missing.push(input);
      continue;
    }
    coverageMap.merge(JSON.parse(fs.readFileSync(input, 'utf8')));
    merged.push(input);
  }

  if (merged.length === 0) {
    return { merged, missing, total: null };
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'coverage-final.json'), JSON.stringify(coverageMap.toJSON()));

  const context = createContext({ dir: outDir, coverageMap });
  istanbulReports.create('json-summary', { file: 'coverage-summary.json' }).execute(context);
  istanbulReports.create('lcovonly', { file: 'lcov.info' }).execute(context);
  istanbulReports.create('clover', { file: 'clover.xml' }).execute(context);
  istanbulReports.create('html', { subdir: 'lcov-report' }).execute(context);

  const total = JSON.parse(fs.readFileSync(path.join(outDir, 'coverage-summary.json'), 'utf8')).total;
  return { merged, missing, total };
}

function warn(message) {
  // A GitHub annotation in CI, so a gap shows on the run page without failing it.
  console.log(process.env.GITHUB_ACTIONS === 'true' ? `::warning::${message}` : `WARNING: ${message}`);
}

function parseArgs(argv) {
  let outDir = DEFAULT_OUT_DIR;
  const inputs = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') {
      outDir = argv[i + 1];
      if (outDir === undefined) {
        return null;
      }
      i += 1;
    } else {
      inputs.push(argv[i]);
    }
  }
  return { outDir, inputs: inputs.length > 0 ? inputs : DEFAULT_INPUTS };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error(`--out needs a directory.\nUsage: ${USAGE}`);
    process.exit(1);
  }
  const { inputs, outDir } = args;
  const { merged, missing, total } = mergeServiceCoverage({ inputs, outDir });

  for (const input of missing) {
    warn(`Service coverage input not found, merged without it: ${input}`);
  }
  if (!total) {
    warn('No service coverage inputs found; no merged report written.');
    process.exit(1);
  }

  console.log('');
  console.log(`Merged service coverage summary (${merged.length} of ${inputs.length} inputs)`);
  console.log(`Statements   : ${total.statements.pct}%`);
  console.log(`Branches     : ${total.branches.pct}%`);
  console.log(`Functions    : ${total.functions.pct}%`);
  console.log(`Lines        : ${total.lines.pct}%`);
  console.log('');
  console.log(`Merged service coverage written to ${outDir}`);
}
