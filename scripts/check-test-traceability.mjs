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
const traceabilityPattern = /\b(?:UC|BR)-[A-Z0-9-]+|pool-master-[a-z0-9]+(?:\.[0-9]+)?|\brule:\s+/i;
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
