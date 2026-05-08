#!/usr/bin/env node
/**
 * pool-master-rop.76.1 — rules:check scanner.
 *
 * Banned pattern (per service-rules.md §1):
 *
 *   const x = process.env.X ?? 'literal-fallback';
 *
 * No `process.env.X ?? '<string-literal>'` fallbacks anywhere in
 * `packages/core-api/src/`. Secrets must come from a single bootstrap
 * source that throws on missing values
 * (`packages/core-api/src/core/config.ts`).
 *
 * The scanner allow-lists numeric and identifier (non-string-literal)
 * fallbacks because those are typically defaults for tunables (timeouts,
 * pool sizes, log levels) — not secrets. If a tunable default needs to
 * be promoted to bootstrap, that's a separate decision; this gate only
 * blocks the specific banned-pattern combo of env-read + string-literal
 * fallback.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SCAN_ROOT = join(process.cwd(), 'packages', 'core-api', 'src');

// Match `process.env.<IDENT> ?? '<NON-EMPTY-LITERAL>'` (or double-quoted /
// backtick-template variants). Empty-string fallback (`?? ''`) is allowed
// because it's a "not configured" sentinel, not a secret default — adapters
// use it to detect when an API key is unset (see odds-api-adapter.ts).
// Backticks are matched alongside single/double quotes because a template
// literal could ship a deterministic dev value just as easily as a string.
const BANNED = /process\.env\.[A-Z_][A-Z0-9_]*\s*\?\?\s*(?:'[^']+'|"[^"]+"|`[^`]+`)/g;

// Skip block-comment continuation lines and `//` line comments so the
// scanner doesn't trip on its own documentation (this file describes the
// banned pattern in prose).
const COMMENT_LINE = /^\s*(?:\*|\/\/)/;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (entry.isFile() && (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx'))) {
      yield fullPath;
    }
  }
}

const violations = [];
for (const file of walk(SCAN_ROOT)) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (COMMENT_LINE.test(lines[i])) continue;
    BANNED.lastIndex = 0;
    if (BANNED.test(lines[i])) {
      violations.push({ file: relative(process.cwd(), file), line: i + 1, text: lines[i].trim() });
    }
  }
}

if (violations.length > 0) {
  console.error(`Found ${violations.length} banned env-fallback pattern(s) in packages/core-api/src/:`);
  console.error('');
  for (const { file, line, text } of violations) {
    console.error(`  ${file}:${line}`);
    console.error(`    ${text}`);
  }
  console.error('');
  console.error('Banned pattern: `process.env.X ?? "string-literal"`. Per service-rules.md §1 and');
  console.error('pool-master-rop.76.1, secrets must come from a single bootstrap source that throws');
  console.error('on missing values. Route the read through `readJwtSecret()` in core/config.ts (or');
  console.error('add a similar bootstrap helper for the new variable) instead of inlining a fallback.');
  process.exit(1);
}

console.log(`No banned env-fallback patterns found in ${SCAN_ROOT}.`);
