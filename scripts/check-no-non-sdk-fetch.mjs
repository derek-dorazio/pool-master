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
  exclude: (path) =>
    path.endsWith('/clients/poolmaster/src/lib/api.ts') ||
    path.endsWith('/clients/poolmaster/src/lib/logger/network-sink.ts') ||
    path.includes('/test/') ||
    path.includes('/tests/') ||
    /\.(test|spec)\.tsx?$/.test(path),
});

const nonSdkFetchPattern = /\b(fetch\s*\(|axios\.|new\s+XMLHttpRequest\s*\()/g;
const findings = [];

for (const filePath of files) {
  const text = readTextFile(filePath);
  for (const match of text.matchAll(nonSdkFetchPattern)) {
    findings.push({
      location: formatLocation(filePath, findLineNumber(text, match.index ?? 0)),
      message: 'Non-SDK HTTP call — use generated SDK operations from @/lib/api.',
    });
  }
}

reportFindings({
  title: 'Non-SDK frontend HTTP scan',
  findings,
  warnOnly,
  emptyMessage: 'No non-SDK frontend HTTP calls found.',
});
