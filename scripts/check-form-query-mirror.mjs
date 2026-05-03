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
  exclude: (path) => /\.(test|spec)\.tsx?$/.test(path),
});

const useEffectPattern = /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]{0,1600}?\}\s*,\s*\[([^\]]*)\]\s*\)/g;
const stateWritePattern = /\b(?:reset|setValue|set[A-Z][A-Za-z0-9_]*)\s*\(/;
const queryDependencyPattern = /\b(?:data|query|result|response|profile|league|team|contest|entry|user)\b/i;
const findings = [];

for (const filePath of files) {
  const text = readTextFile(filePath);
  for (const match of text.matchAll(useEffectPattern)) {
    const effectText = match[0];
    const dependencyText = match[1] ?? '';
    if (!stateWritePattern.test(effectText)) continue;
    if (!queryDependencyPattern.test(dependencyText)) continue;

    findings.push({
      location: formatLocation(filePath, findLineNumber(text, match.index ?? 0)),
      message: 'Review useEffect state/form writes from query-like dependencies; avoid overwriting user edits on refetch.',
    });
  }
}

reportFindings({
  title: 'Form/query mirror baseline scan',
  findings,
  warnOnly,
  emptyMessage: 'No form/query mirror hazards found.',
});
