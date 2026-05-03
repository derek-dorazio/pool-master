import {
  findLineNumber,
  formatLocation,
  parseRuleCheckArgs,
  readTextFile,
  reportFindings,
  walkFiles,
} from './rule-check-utils.mjs';

const { warnOnly } = parseRuleCheckArgs();
const files = walkFiles(['clients/poolmaster/src'], {
  extensions: ['ts', 'tsx'],
});

const bannedMockPattern = /\bvi\.mock\(\s*['"]@\/lib\/api(?:-client)?['"]/g;
const findings = [];

for (const filePath of files) {
  const text = readTextFile(filePath);
  for (const match of text.matchAll(bannedMockPattern)) {
    findings.push({
      location: formatLocation(filePath, findLineNumber(text, match.index ?? 0)),
      message: 'Do not module-mock the generated API boundary; use MSW or lower-level test fixtures.',
    });
  }
}

reportFindings({
  title: 'No mocked generated API boundary',
  findings,
  warnOnly,
  emptyMessage: 'No mocked generated API boundary usages found.',
});
