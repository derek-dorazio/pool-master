import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DEFAULT_EXCLUDED_DIRS = new Set([
  '.git',
  '.turbo',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'test-results',
]);

export function parseRuleCheckArgs(argv = process.argv.slice(2)) {
  return {
    warnOnly: argv.includes('--warn-only'),
  };
}

export function readTextFile(filePath) {
  return readFileSync(filePath, 'utf8');
}

export function walkFiles(roots, options = {}) {
  const cwd = process.cwd();
  const extensions = options.extensions ? new Set(options.extensions) : null;
  const excludedDirs = new Set([...DEFAULT_EXCLUDED_DIRS, ...(options.excludedDirs ?? [])]);
  const files = [];

  function visit(path) {
    let stats;
    try {
      stats = statSync(path);
    } catch {
      return;
    }

    if (stats.isDirectory()) {
      const name = path.split('/').at(-1);
      if (name && excludedDirs.has(name)) return;
      for (const child of readdirSync(path)) {
        visit(join(path, child));
      }
      return;
    }

    if (!stats.isFile()) return;
    if (extensions && !extensions.has(path.split('.').at(-1))) return;
    if (options.include && !options.include(path)) return;
    if (options.exclude && options.exclude(path)) return;
    files.push(path);
  }

  for (const root of roots) {
    visit(join(cwd, root));
  }

  return files;
}

export function formatLocation(filePath, lineNumber) {
  const rel = relative(process.cwd(), filePath);
  return lineNumber ? `${rel}:${lineNumber}` : rel;
}

export function findLineNumber(text, index) {
  return text.slice(0, index).split('\n').length;
}

export function lineHasAdjacentMarker(lines, index, markerPattern) {
  const start = Math.max(0, index - 2);
  for (let i = start; i <= index; i += 1) {
    if (markerPattern.test(lines[i] ?? '')) return true;
  }
  return false;
}

export function reportFindings({ title, findings, warnOnly = false, emptyMessage }) {
  if (findings.length === 0) {
    console.log(emptyMessage ?? `${title}: no findings.`);
    return;
  }

  const level = warnOnly ? 'WARN' : 'FAIL';
  console.log(`${title}: ${level} - ${findings.length} finding(s).`);
  for (const finding of findings) {
    console.log(`- ${finding.location}: ${finding.message}`);
  }

  if (!warnOnly) {
    process.exitCode = 1;
  }
}
