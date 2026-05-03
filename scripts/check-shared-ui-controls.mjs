import {
  findLineNumber,
  formatLocation,
  parseRuleCheckArgs,
  readTextFile,
  reportFindings,
  walkFiles,
} from './rule-check-utils.mjs';

const { warnOnly } = parseRuleCheckArgs();
const files = walkFiles(['clients/poolmaster/src/features'], {
  extensions: ['tsx'],
  exclude: (path) =>
    path.includes('/features/shared/ui/') ||
    /\.(test|spec)\.tsx?$/.test(path),
});

const bareControlPattern = /<(button|input|textarea)\b/g;
const findings = [];

for (const filePath of files) {
  const text = readTextFile(filePath);
  for (const match of text.matchAll(bareControlPattern)) {
    findings.push({
      location: formatLocation(filePath, findLineNumber(text, match.index ?? 0)),
      message: `Use the shared UI ${match[1]} primitive or add/extend one in features/shared/ui.`,
    });
  }
}

reportFindings({
  title: 'Shared UI control adoption scan',
  findings,
  warnOnly,
  emptyMessage: 'No bare form/action controls found outside shared UI.',
});
