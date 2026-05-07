import ts from 'typescript';
import {
  formatLocation,
  parseRuleCheckArgs,
  readTextFile,
  reportFindings,
  walkFiles,
} from './rule-check-utils.mjs';

const QUERY_KEYS_PATH = 'clients/poolmaster/src/lib/query-keys.ts';

const { warnOnly } = parseRuleCheckArgs();
const files = walkFiles(['clients/poolmaster/src'], {
  extensions: ['ts', 'tsx'],
  exclude: (path) => path.endsWith(`/${QUERY_KEYS_PATH}`),
});

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return null;
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function collectInlineQueryKeyFindings(filePath) {
  const text = readTextFile(filePath);
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings = [];

  function visit(node) {
    if (
      ts.isPropertyAssignment(node) &&
      propertyNameText(node.name) === 'queryKey' &&
      ts.isArrayLiteralExpression(unwrapExpression(node.initializer))
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.name.getStart(sourceFile));
      findings.push({
        location: formatLocation(filePath, line + 1),
        message: 'Inline queryKey array — use QueryKeys from clients/poolmaster/src/lib/query-keys.ts.',
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

const findings = files.flatMap(collectInlineQueryKeyFindings);

reportFindings({
  title: 'Inline TanStack Query key scan (pool-master-rop.78.9)',
  findings,
  warnOnly,
  emptyMessage: 'No inline TanStack Query key arrays found.',
});
