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
// Accepts the current form (`SKIP: #123`, a GitHub issue) and the pre-migration
// Beads form (`SKIP: pool-master-abc.1`). The old markers are not rewritten --
// they resolve into git history, and rewriting them would touch every test file
// to change nothing. See docs/adr/0006-github-issues-as-live-task-tracker.md.
const skipStoryPattern = /SKIP:\s*(?:#[0-9]+|pool-master-[a-z0-9]+(?:\.[0-9]+)*)\b/i;
const skippedFilePattern = /(?:^|\/)(?:skipped\/|.*\.skip\.(?:test|spec)\.tsx?$)/;
const findings = [];

for (const filePath of files) {
  if (skippedFilePattern.test(filePath)) {
    findings.push({
      location: formatLocation(filePath),
      message: 'Skipped test files/directories require an adjacent SKIP: #<issue> marker.',
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
      message: 'Disabled/todo/failing tests require an adjacent SKIP: #<issue> marker.',
    });
  });
}

reportFindings({
  title: 'Test-disable discipline scan',
  findings,
  warnOnly,
  emptyMessage: 'No undocumented disabled tests found.',
});
