import ts from 'typescript';
import {
  formatLocation,
  parseRuleCheckArgs,
  readTextFile,
  reportFindings,
  walkFiles,
} from './rule-check-utils.mjs';

const GENERATED_TYPES_PATH = 'packages/shared/generated/hey-api/types.gen.ts';
const { warnOnly } = parseRuleCheckArgs();

function collectGeneratedTypeNames() {
  const text = readTextFile(GENERATED_TYPES_PATH);
  const sourceFile = ts.createSourceFile(
    GENERATED_TYPES_PATH,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = new Set();

  function visit(node) {
    if ((ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return names;
}

const generatedTypeNames = collectGeneratedTypeNames();
const files = walkFiles(['clients/poolmaster/src'], {
  extensions: ['ts', 'tsx'],
  exclude: (path) => /\.(test|spec)\.tsx?$/.test(path),
});

function collectFindings(filePath) {
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
    if ((ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.name) {
      const name = node.name.text;
      if (generatedTypeNames.has(name)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.name.getStart(sourceFile));
        findings.push({
          location: formatLocation(filePath, line + 1),
          message: `Local API-shaped type "${name}" duplicates a generated hey-api type.`,
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
  title: 'Parallel frontend API type scan',
  findings,
  warnOnly,
  emptyMessage: 'No frontend types duplicate generated hey-api names.',
});
