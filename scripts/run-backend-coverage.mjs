import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import istanbulCoverage from 'istanbul-lib-coverage';
import istanbulReport from 'istanbul-lib-report';
import istanbulReports from 'istanbul-reports';

const { createCoverageMap } = istanbulCoverage;
const { createContext } = istanbulReport;
const reports = istanbulReports;

const rootDir = process.cwd();
const coverageRoot = path.join(rootDir, 'coverage');
const unitDir = path.join(coverageRoot, 'unit');
const integrationDir = path.join(coverageRoot, 'integration');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function printSummary(label, summaryPath) {
  const data = readJson(summaryPath);
  const total = data.total;
  console.log('');
  console.log(`${label} coverage summary`);
  console.log(`Statements   : ${total.statements.pct}%`);
  console.log(`Branches     : ${total.branches.pct}%`);
  console.log(`Functions    : ${total.functions.pct}%`);
  console.log(`Lines        : ${total.lines.pct}%`);
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readCoverageJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Coverage file not found: ${filePath}`);
  }
  return readJson(filePath);
}

removeDir(coverageRoot);
fs.mkdirSync(coverageRoot, { recursive: true });

run('npm', ['run', 'test:coverage:unit']);
run('npm', ['run', 'test:coverage:integration']);

printSummary('Unit', path.join(unitDir, 'coverage-summary.json'));
printSummary('Integration', path.join(integrationDir, 'coverage-summary.json'));

const coverageMap = createCoverageMap({});
coverageMap.merge(readCoverageJson(path.join(unitDir, 'coverage-final.json')));
coverageMap.merge(readCoverageJson(path.join(integrationDir, 'coverage-final.json')));

fs.writeFileSync(
  path.join(coverageRoot, 'coverage-final.json'),
  JSON.stringify(coverageMap.toJSON()),
);

const context = createContext({
  dir: coverageRoot,
  coverageMap,
});

reports.create('json-summary', { file: 'coverage-summary.json' }).execute(context);
reports.create('lcovonly', { file: 'lcov.info' }).execute(context);
reports.create('clover', { file: 'clover.xml' }).execute(context);
reports.create('html', { subdir: 'lcov-report' }).execute(context);
reports.create('text-summary').execute(context);

printSummary('Merged backend', path.join(coverageRoot, 'coverage-summary.json'));

console.log('');
console.log(`Merged backend coverage written to ${coverageRoot}`);
