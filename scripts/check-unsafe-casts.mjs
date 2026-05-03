import {
  findLineNumber,
  formatLocation,
  parseRuleCheckArgs,
  readTextFile,
  reportFindings,
  walkFiles,
} from './rule-check-utils.mjs';

const { warnOnly } = parseRuleCheckArgs();
const files = walkFiles(['packages', 'clients/poolmaster/src'], {
  extensions: ['ts', 'tsx'],
  exclude: (path) => /\.(test|spec)\.tsx?$/.test(path) || path.includes('/scripts/'),
});

const findings = [];
const castPatterns = [
  {
    pattern: /\bas\s+unknown\s+as\b/g,
    message: 'Do not bridge generated/domain contract gaps with "as unknown as"; fix the contract or mapper.',
  },
  {
    pattern: /\bas\s+any\b/g,
    message: 'Avoid "as any" in application code; use a real type, helper, or documented boundary.',
  },
];

for (const filePath of files) {
  const text = readTextFile(filePath);
  for (const { pattern, message } of castPatterns) {
    for (const match of text.matchAll(pattern)) {
      findings.push({
        location: formatLocation(filePath, findLineNumber(text, match.index ?? 0)),
        message,
      });
    }
  }
}

reportFindings({
  title: 'Unsafe cast scan',
  findings,
  warnOnly,
  emptyMessage: 'No unsafe casts found.',
});
