import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_INPUTS } from './merge-service-coverage.mjs';

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

removeDir(serviceUnitDir);
removeDir(serviceIntegrationDir);
removeDir(serviceFunctionalApiDir);
removeDir(serviceMergedDir);
fs.mkdirSync(coverageRoot, { recursive: true });

// The FAPI server can only be covered by V8 (it runs out of process, outside Jest's Babel
// instrumentation), and merging needs every suite to count the same way: V8 emits per-line
// statement maps, Babel real statements, and unioning the two double-counts (#296). So the
// Jest suites switch to V8 here, and only here — their configs default to Babel, which is what
// CI's unit coverage gate measures (#302).
const V8 = ['--', '--coverageProvider=v8'];

console.log('Running service unit tests with coverage...');
run('npm', ['run', 'test:coverage:service:unit', ...V8]);
console.log('Running service integration tests with coverage...');
run('npm', ['run', 'test:coverage:service:integration', ...V8]);
console.log('Running service functional API tests with coverage...');
run('npm', ['run', 'test:coverage:service:functional-api']);

printSummary('Service unit', path.join(serviceUnitDir, 'coverage-summary.json'));
printSummary('Service integration', path.join(serviceIntegrationDir, 'coverage-summary.json'));
printSummary('Service functional API', path.join(serviceFunctionalApiDir, 'coverage-summary.json'));

// The merge itself lives in merge-service-coverage.mjs (#294), so it can also merge
// per-suite coverage produced somewhere other than this script.
run('node', ['scripts/merge-service-coverage.mjs', '--out', serviceMergedDir, ...DEFAULT_INPUTS]);
