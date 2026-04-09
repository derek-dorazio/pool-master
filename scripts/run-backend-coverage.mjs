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
const serviceUnitDir = path.join(coverageRoot, 'service-unit');
const serviceIntegrationDir = path.join(coverageRoot, 'service-integration');
const serviceFunctionalApiDir = path.join(coverageRoot, 'service-functional-api');
const serviceMergedDir = path.join(coverageRoot, 'service-merged');

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

removeDir(serviceUnitDir);
removeDir(serviceIntegrationDir);
removeDir(serviceFunctionalApiDir);
removeDir(serviceMergedDir);
fs.mkdirSync(coverageRoot, { recursive: true });

console.log('Running service unit tests with coverage...');
run('npm', ['run', 'test:coverage:service:unit']);
console.log('Running service integration tests with coverage...');
run('npm', ['run', 'test:coverage:service:integration']);
console.log('Running service functional API tests with coverage...');
run('npm', ['run', 'test:coverage:service:functional-api']);

printSummary('Service unit', path.join(serviceUnitDir, 'coverage-summary.json'));
printSummary('Service integration', path.join(serviceIntegrationDir, 'coverage-summary.json'));
printSummary('Service functional API', path.join(serviceFunctionalApiDir, 'coverage-summary.json'));

const coverageMap = createCoverageMap({});
coverageMap.merge(readCoverageJson(path.join(serviceUnitDir, 'coverage-final.json')));
coverageMap.merge(readCoverageJson(path.join(serviceIntegrationDir, 'coverage-final.json')));
coverageMap.merge(readCoverageJson(path.join(serviceFunctionalApiDir, 'coverage-final.json')));

fs.mkdirSync(serviceMergedDir, { recursive: true });
fs.writeFileSync(
  path.join(serviceMergedDir, 'coverage-final.json'),
  JSON.stringify(coverageMap.toJSON()),
);

const context = createContext({
  dir: serviceMergedDir,
  coverageMap,
});

reports.create('json-summary', { file: 'coverage-summary.json' }).execute(context);
reports.create('lcovonly', { file: 'lcov.info' }).execute(context);
reports.create('clover', { file: 'clover.xml' }).execute(context);
reports.create('html', { subdir: 'lcov-report' }).execute(context);
reports.create('text-summary').execute(context);

printSummary('Merged service', path.join(serviceMergedDir, 'coverage-summary.json'));

console.log('');
console.log(`Merged service coverage written to ${serviceMergedDir}`);
