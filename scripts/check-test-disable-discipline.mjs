import {
  formatLocation,
  lineHasAdjacentMarker,
  parseRuleCheckArgs,
  readTextFile,
  reportFindings,
  walkFiles,
} from './rule-check-utils.mjs';

const { warnOnly } = parseRuleCheckArgs();
const files = walkFiles(['tests', 'packages', 'clients/poolmaster/src'], {
  extensions: ['ts', 'tsx'],
});

const disabledMarkerPatterns = [
  /\b(?:it|test|describe)\.(?:skip|todo|fails|failing)\s*\(/,
  /^\s*x(?:it|test|describe)\s*\(/,
  /\bpending\s*\(/,
];
const skipStoryPattern = /SKIP:\s*pool-master-[a-z0-9]+(?:\.[0-9]+)?\b/i;
const skippedFilePattern = /(?:^|\/)(?:skipped\/|.*\.skip\.(?:test|spec)\.tsx?$)/;
const findings = [];

for (const filePath of files) {
  if (skippedFilePattern.test(filePath)) {
    findings.push({
      location: formatLocation(filePath),
      message: 'Skipped test files/directories require a SKIP: pool-master-* story marker.',
    });
    continue;
  }

  const text = readTextFile(filePath);
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (!disabledMarkerPatterns.some((pattern) => pattern.test(line))) return;
    if (lineHasAdjacentMarker(lines, index, skipStoryPattern)) return;

    findings.push({
      location: formatLocation(filePath, index + 1),
      message: 'Disabled/todo/failing tests require an adjacent SKIP: pool-master-* story marker.',
    });
  });
}

reportFindings({
  title: 'Test-disable discipline scan',
  findings,
  warnOnly,
  emptyMessage: 'No undocumented disabled tests found.',
});
