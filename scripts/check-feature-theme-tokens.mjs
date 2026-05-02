import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = new URL('..', import.meta.url).pathname;
const featureRoot = join(repoRoot, 'clients/poolmaster/src/features');
const allowedPathFragments = [
  'clients/poolmaster/src/features/shared/ui/',
];
const checkedExtensions = new Set(['.ts', '.tsx', '.css']);
const rawTailwindColorPattern =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke|accent|decoration)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}(?:\/\d+)?\b/g;
const rawColorLiteralPattern =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/g;

function collectFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    const stats = statSync(path);

    if (stats.isDirectory()) {
      return collectFiles(path);
    }

    const extension = path.match(/\.[^.]+$/)?.[0] ?? '';
    return checkedExtensions.has(extension) ? [path] : [];
  });
}

function isAllowedPath(path) {
  const normalized = relative(repoRoot, path).replaceAll('\\', '/');
  return allowedPathFragments.some((fragment) => normalized.startsWith(fragment));
}

const violations = [];

for (const file of collectFiles(featureRoot)) {
  if (isAllowedPath(file)) {
    continue;
  }

  const text = readFileSync(file, 'utf8');
  const relativePath = relative(repoRoot, file);
  const lines = text.split('\n');

  lines.forEach((line, index) => {
    const rawTailwindMatches = line.match(rawTailwindColorPattern) ?? [];
    const rawColorMatches = line.match(rawColorLiteralPattern) ?? [];
    const matches = [...rawTailwindMatches, ...rawColorMatches];

    if (matches.length > 0) {
      violations.push({
        line: index + 1,
        matches,
        path: relativePath,
      });
    }
  });
}

if (violations.length > 0) {
  console.error('Feature code must use semantic theme tokens or shared UI primitives.');
  console.error('Raw color scale classes and literal colors are limited to theme/shared UI layers.\n');

  for (const violation of violations) {
    console.error(
      `${violation.path}:${violation.line} ${violation.matches.join(', ')}`,
    );
  }

  process.exit(1);
}

console.log('Feature theme token check passed.');
