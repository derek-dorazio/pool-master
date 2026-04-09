import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import v8ToIstanbul from 'v8-to-istanbul';
import istanbulCoverage from 'istanbul-lib-coverage';
import istanbulReport from 'istanbul-lib-report';
import istanbulReports from 'istanbul-reports';

const { createCoverageMap } = istanbulCoverage;
const { createContext } = istanbulReport;
const reports = istanbulReports;

const rootDir = process.cwd();
const coverageRoot = path.join(rootDir, 'coverage');
const serviceFunctionalApiDir = path.join(coverageRoot, 'service-functional-api');
const serviceFunctionalApiV8Dir = path.join(coverageRoot, 'service-functional-api-v8');

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function isRelevantSourceFile(filePath) {
  if (!filePath.startsWith(rootDir)) {
    return false;
  }

  const relativePath = path.relative(rootDir, filePath);
  if (relativePath.startsWith('node_modules')) {
    return false;
  }

  if (
    relativePath.startsWith(path.join('packages', 'core-api', 'src'))
    || relativePath.startsWith(path.join('packages', 'shared'))
  ) {
    if (
      relativePath.startsWith(path.join('packages', 'shared', 'dist'))
      || relativePath.startsWith(path.join('packages', 'shared', 'generated'))
    ) {
      return false;
    }
    return relativePath.endsWith('.ts') || relativePath.endsWith('.tsx');
  }

  return false;
}

function normalizeCoverageUrl(url) {
  if (!url || url.startsWith('node:') || url.startsWith('internal')) {
    return null;
  }

  if (url.startsWith('file://')) {
    return fileURLToPath(url);
  }

  if (path.isAbsolute(url)) {
    return url;
  }

  return null;
}

async function buildFunctionalCoverage() {
  const coverageMap = createCoverageMap({});
  const entries = fs.readdirSync(serviceFunctionalApiV8Dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const raw = JSON.parse(
      fs.readFileSync(path.join(serviceFunctionalApiV8Dir, entry.name), 'utf8'),
    );

    for (const scriptCoverage of raw.result ?? []) {
      const filePath = normalizeCoverageUrl(scriptCoverage.url);
      if (!filePath || !fs.existsSync(filePath) || !isRelevantSourceFile(filePath)) {
        continue;
      }

      const converter = v8ToIstanbul(filePath);
      await converter.load();
      converter.applyCoverage(scriptCoverage.functions ?? []);
      coverageMap.merge(converter.toIstanbul());
    }
  }

  return coverageMap;
}

function writeCoverageReports(coverageMap) {
  fs.mkdirSync(serviceFunctionalApiDir, { recursive: true });
  fs.writeFileSync(
    path.join(serviceFunctionalApiDir, 'coverage-final.json'),
    JSON.stringify(coverageMap.toJSON()),
  );

  const context = createContext({
    dir: serviceFunctionalApiDir,
    coverageMap,
  });

  reports.create('json-summary', { file: 'coverage-summary.json' }).execute(context);
  reports.create('json', { file: 'coverage-report.json' }).execute(context);
  reports.create('lcovonly', { file: 'lcov.info' }).execute(context);
  reports.create('clover', { file: 'clover.xml' }).execute(context);
  reports.create('html', { subdir: 'lcov-report' }).execute(context);
  reports.create('text-summary').execute(context);
}

function printSummary() {
  const summaryPath = path.join(serviceFunctionalApiDir, 'coverage-summary.json');
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')).total;

  console.log('');
  console.log('Service functional API coverage summary');
  console.log(`Statements   : ${summary.statements.pct}%`);
  console.log(`Branches     : ${summary.branches.pct}%`);
  console.log(`Functions    : ${summary.functions.pct}%`);
  console.log(`Lines        : ${summary.lines.pct}%`);
}

removeDir(serviceFunctionalApiDir);
removeDir(serviceFunctionalApiV8Dir);
fs.mkdirSync(serviceFunctionalApiV8Dir, { recursive: true });

run('npm', ['run', 'test:service:functional-api'], {
  ...process.env,
  FUNCTIONAL_SERVER_V8_COVERAGE_DIR: serviceFunctionalApiV8Dir,
  NODE_V8_COVERAGE: serviceFunctionalApiV8Dir,
});

const coverageMap = await buildFunctionalCoverage();
writeCoverageReports(coverageMap);
printSummary();

