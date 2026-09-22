import {
  formatLocation,
  parseRuleCheckArgs,
  readTextFile,
  reportFindings,
  walkFiles,
} from './rule-check-utils.mjs';

const { warnOnly } = parseRuleCheckArgs();
const files = walkFiles(['tests', 'packages', 'clients/poolmaster/src'], {
  extensions: ['ts', 'tsx'],
  include: (path) => /\.(test|spec)\.tsx?$/.test(path) || path.includes('/tests/'),
});

const testCasePattern = /\b(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]/;
// A GitHub issue reference is accepted in two unambiguous forms -- `#118:` or
// `defect #118` -- rather than a bare `#\d+`, which would let an incidental
// '#1 ranked player' in a test name pass as traceability. Legacy
// `pool-master-*` IDs stay accepted; they resolve into git history and are not
// rewritten. Plan 138 revisits this pattern set as a whole.
const traceabilityPattern =
  /\b(?:UC|BR)-[A-Z0-9-]+|pool-master-[a-z0-9]+(?:\.[0-9]+)*|#[0-9]{1,6}:|\b(?:defect|issue)\s+#[0-9]{1,6}\b|\brule:\s+/i;
const findings = [];

for (const filePath of files) {
  const text = readTextFile(filePath);
  const lines = text.split('\n');

  lines.forEach((line, index) => {
    const match = line.match(testCasePattern);
    if (!match) return;

    const contextStart = Math.max(0, index - 4);
    const contextEnd = Math.min(lines.length - 1, index + 1);
    const context = lines.slice(contextStart, contextEnd + 1).join('\n');
    if (traceabilityPattern.test(context)) return;

    findings.push({
      location: formatLocation(filePath, index + 1),
      message: `Test "${match[1]}" should reference a UC, BR, defect, or rule id.`,
    });
  });
}

reportFindings({
  title: 'Test traceability baseline scan',
  findings,
  warnOnly,
  emptyMessage: 'No test traceability gaps found.',
});
