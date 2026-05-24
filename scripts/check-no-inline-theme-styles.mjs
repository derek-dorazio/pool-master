import ts from 'typescript';
import {
  formatLocation,
  parseRuleCheckArgs,
  readTextFile,
  reportFindings,
  walkFiles,
} from './rule-check-utils.mjs';

const { warnOnly } = parseRuleCheckArgs();
const files = walkFiles(['clients/poolmaster/src'], {
  extensions: ['tsx'],
  exclude: (path) => /\.(test|spec)\.tsx?$/.test(path),
});

const themeStyleNames = new Set([
  'background',
  'backgroundColor',
  'border',
  'borderColor',
  'borderRadius',
  'boxShadow',
  'color',
  'columnGap',
  'font',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'gap',
  'letterSpacing',
  'lineHeight',
  'margin',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginTop',
  'padding',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'rowGap',
  'textShadow',
]);

function propertyNameText(name) {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function isLiteralThemeValue(expression) {
  return (
    ts.isStringLiteralLike(expression) ||
    ts.isNumericLiteral(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword
  );
}

function collectFindings(filePath) {
  const text = readTextFile(filePath);
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings = [];

  function visit(node) {
    if (
      ts.isJsxAttribute(node) &&
      node.name.text === 'style' &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      ts.isObjectLiteralExpression(node.initializer.expression)
    ) {
      for (const property of node.initializer.expression.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const propertyName = propertyNameText(property.name);
        if (!propertyName || !themeStyleNames.has(propertyName)) continue;
        if (!isLiteralThemeValue(property.initializer)) continue;
        const { line } = sourceFile.getLineAndCharacterOfPosition(property.name.getStart(sourceFile));
        findings.push({
          location: formatLocation(filePath, line + 1),
          message: `Inline theme style "${propertyName}" — use semantic classes/CSS variables instead.`,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

const findings = files.flatMap(collectFindings);

reportFindings({
  title: 'Inline theme style scan',
  findings,
  warnOnly,
  emptyMessage: 'No inline theme styles found.',
});
