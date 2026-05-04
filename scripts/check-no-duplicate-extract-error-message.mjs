/**
 * Detects duplicate `extractErrorMessage` definitions outside the canonical
 * shared module at `clients/poolmaster/src/lib/errors.ts`.
 *
 * The canonical implementation supports `codeMessages` (per-feature error-code
 * → user-friendly copy mapping) and a configurable fallback. Local copies
 * historically drifted out of sync — different fallback strings, no
 * `codeMessages` support — leaving user-facing error copy inconsistent across
 * surfaces. See pool-master-rop.19.
 *
 * Findings:
 *   - Any `function extractErrorMessage(...)` declaration inside
 *     `clients/poolmaster/src/` outside `clients/poolmaster/src/lib/errors.ts`.
 *   - Any `const extractErrorMessage = ...` arrow-function alias.
 *
 * Allowed:
 *   - The canonical export at `clients/poolmaster/src/lib/errors.ts`.
 *   - Re-imports / wrappers that *call* the canonical extractor — the scanner
 *     only flags fresh function definitions.
 *
 * Rule: every consumer should `import { extractErrorMessage } from '@/lib/errors'`
 * (or the workspace-relative alias) and pass `{ fallback, codeMessages? }`.
 */

import {
  findLineNumber,
  formatLocation,
  parseRuleCheckArgs,
  readTextFile,
  reportFindings,
  walkFiles,
} from './rule-check-utils.mjs';

const CANONICAL_PATH = 'clients/poolmaster/src/lib/errors.ts';

const { warnOnly } = parseRuleCheckArgs();
const files = walkFiles(['clients/poolmaster/src'], {
  extensions: ['ts', 'tsx'],
  // Match the canonical path against the full repo-relative path, not just
  // the last two segments. Otherwise a future file at e.g.
  // features/shared/lib/errors.ts would be silently excluded as if it were
  // canonical, and any duplicate extractErrorMessage there would slip past
  // the scanner.
  exclude: (path) =>
    path.endsWith(`/${CANONICAL_PATH}`) ||
    /\.(test|spec)\.tsx?$/.test(path),
});

const declarationPattern = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+extractErrorMessage\b/g;
const arrowPattern = /(?:^|\n)\s*(?:export\s+)?const\s+extractErrorMessage\s*[:=]/g;

const findings = [];

for (const filePath of files) {
  const text = readTextFile(filePath);
  for (const match of text.matchAll(declarationPattern)) {
    findings.push({
      location: formatLocation(filePath, findLineNumber(text, match.index ?? 0)),
      message: 'Local extractErrorMessage definition — import from @/lib/errors instead.',
    });
  }
  for (const match of text.matchAll(arrowPattern)) {
    findings.push({
      location: formatLocation(filePath, findLineNumber(text, match.index ?? 0)),
      message: 'Local extractErrorMessage alias — import from @/lib/errors instead.',
    });
  }
}

reportFindings({
  title: 'Duplicate extractErrorMessage scan (pool-master-rop.19)',
  findings,
  warnOnly,
  emptyMessage: 'No duplicate extractErrorMessage definitions found.',
});
