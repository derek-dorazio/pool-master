import {
  findLineNumber,
  formatLocation,
  parseRuleCheckArgs,
  readTextFile,
  reportFindings,
  walkFiles,
} from './rule-check-utils.mjs';

const { warnOnly } = parseRuleCheckArgs();
const files = walkFiles(['packages/core-api/src/modules'], {
  extensions: ['ts'],
  include: (path) => /\/(routes|handler|handlers)\.ts$/.test(path),
});

const patterns = [
  {
    pattern: /\badditionalProperties\s*:\s*true\b/g,
    message: 'Route schemas should not allow additionalProperties: true without a documented exception.',
  },
  {
    pattern: /\bSuccessSchema\b/g,
    message: 'Do not use SuccessSchema for endpoints that return domain data.',
  },
  {
    pattern: /\bprisma\.[a-zA-Z_][a-zA-Z0-9_]*/g,
    message: 'Handlers/routes must not access Prisma directly; use services/repositories.',
  },
  {
    pattern: /\breply\.send\s*\(\s*await\s+prisma\./g,
    message: 'Handlers/routes must not send raw Prisma query results.',
  },
  {
    pattern: /\.map\s*\(/g,
    message: 'Handler-level DTO shaping with .map() belongs in a mapper.',
  },
  {
    pattern: /\btype\s*:\s*['"]object['"][\s\S]{0,220}\bproperties\s*:/g,
    message: 'Inline object response/request schemas should normally come from shared DTO schemas.',
  },
];

const findings = [];

for (const filePath of files) {
  const text = readTextFile(filePath);
  for (const { pattern, message } of patterns) {
    for (const match of text.matchAll(pattern)) {
      findings.push({
        location: formatLocation(filePath, findLineNumber(text, match.index ?? 0)),
        message,
      });
    }
  }
}

reportFindings({
  title: 'Route discipline scan',
  findings,
  warnOnly,
  emptyMessage: 'Route discipline scan found no issues.',
});
