/**
 * Feature theme-token scanner.
 *
 * WHY THIS IS STILL A SCRIPT. #134 migrated every other expressible scanner to the local
 * ESLint plugin in `eslint-rules/`. This one deliberately stayed, and the reason is the
 * `.css` entry in `checkedExtensions` below: ESLint cannot lint CSS without `@eslint/css`,
 * which is not installed.
 *
 * Both ways to migrate it are worse than leaving it:
 *
 *   - Migrate the .ts/.tsx half and keep a trimmed script for .css — one convention
 *     enforced by two mechanisms, each of which reads as complete.
 *   - Migrate everything and let .css go unchecked — there are zero .css files under
 *     features/ today, so the gap would be invisible until the first one is added.
 *
 * Adding `@eslint/css` is a real option; it was not taken unilaterally during #134.
 * #207 tracks doing exactly that and deleting this script. Until then, the
 * `stripCommentContent` pass below is a hand-rolled stand-in for syntax awareness an
 * ESLint rule would get from the AST for nothing.
 * `poolmaster/no-inline-theme-styles` is the ESLint rule that covers the adjacent case
 * (literal values on theme-bearing props in JSX), and the two are complementary rather
 * than duplicates: this scans class strings and colour literals, that scans style props.
 */

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

/**
 * Blanks out comment content, keeping the line structure so reported line numbers stay
 * accurate.
 *
 * WHY. This scanner is a line-based regex pass with no syntax awareness, so `#206` in a
 * comment matched `#[0-9a-fA-F]{3,8}` — `206` is a valid three-digit CSS shorthand. Any
 * GitHub issue reference whose number is 3-8 hex-ish characters tripped it, which cost
 * #192 and #206 a lint round each. An ESLint rule would get this free from the AST (#207).
 *
 * KNOWN LIMITATION, also #207: a hex-looking URL fragment in a string — say
 * 'https://example.com/theme#abc123' — is still reported. String contents are kept on
 * purpose, so this pass cannot tell a URL constant from a class string.
 *
 * String contents are deliberately KEPT: a raw colour in a template literal or a class
 * string is a real violation. Only comment bodies are dropped.
 *
 * The string tracking exists so `https://…#abc123` is not mistaken for a line comment
 * that swallows the rest of the line. Where this scanner's simple tracking is wrong —
 * a regex literal containing a quote, say — it fails toward tracking a string as still
 * open, which means less stripping and therefore a possible false positive, never a
 * missed violation.
 */
function stripCommentContent(text) {
  let out = '';
  let inBlockComment = false;
  let quote = null;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        out += '  ';
        i += 1;
        continue;
      }
      // Keep newlines so line numbers and per-line scanning are unaffected.
      out += char === '\n' ? '\n' : ' ';
      continue;
    }

    if (quote) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        i += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      out += '  ';
      i += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      // Line comment: blank to end of line, but keep the newline itself.
      let j = i;
      while (j < text.length && text[j] !== '\n') {
        out += ' ';
        j += 1;
      }
      i = j - 1;
      continue;
    }

    out += char;
  }

  return out;
}

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

  const text = stripCommentContent(readFileSync(file, 'utf8'));
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
