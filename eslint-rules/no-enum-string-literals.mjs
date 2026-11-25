/**
 * The web app names a shared enum member instead of writing its value as a string (#2107;
 * rules/domain-model-conventions-rules.md §17 *Rules Live In The Model, Not In Code*).
 *
 * `status === 'OPEN'`, `case 'FINAL':` and `type Mode = 'PICK_EM' | 'SURVIVOR'` all spell out a
 * contract value by hand. The compiler keeps the spelling valid, but a renamed or retired member
 * leaves the literal behind, and a literal union is a local copy of an enum the contract already
 * exports. The fix is the enum member (`ContestStatus.OPEN`) or the enum's type.
 *
 * `no-bare-enum-literals` covers only `x.field === 'X'` where `field` is a Prisma enum column. This
 * rule reads every enum the shared domain exports (a `const` object whose every value equals its
 * key, found by `check-web-shared-imports.mjs`'s parser so both gates agree on what an enum is) and reports a string literal equal to one of their values when it is compared (`===`,
 * `!==`, `==`, `!=`), used as a `case` label, or written as a literal type.
 *
 * A string that only happens to equal an enum value (a local tone, a CSS keyword) takes
 * `// poolmaster-allow-enum-literal: <reason>` on the line before.
 *
 * Grandfathered files sit on a shrink-only count (`eslint-rules/enum-string-literal-baseline.json`):
 * a file over its count has every hit reported, so it cannot add one, and
 * `rules:check:baseline-ratchet` keeps the counts going down.
 */
import { relative, sep } from 'node:path';

import { sharedEnumValuesOnDisk } from '../scripts/check-web-shared-imports.mjs';
import { allowMarkers } from './allow-markers.mjs';

const COMPARISON = new Set(['===', '!==', '==', '!=']);

let cache = null;

/**
 * Every value of an enum the shared domain exports, mapped to the names of the enums that hold it.
 * Read with the TypeScript parser by the import check's own definition of an enum, once per lint
 * process.
 */
export function sharedEnumValues(cwd) {
  if (cache !== null) return cache;
  try {
    cache = sharedEnumValuesOnDisk(cwd);
  } catch {
    // No shared domain in this tree: nothing to compare against.
    cache = new Map();
  }
  return cache;
}

function isJudgedPosition(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === 'BinaryExpression' && COMPARISON.has(parent.operator)) return true;
  if (parent.type === 'SwitchCase' && parent.test === node) return true;
  return parent.type === 'TSLiteralType';
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'No shared enum value written as a string literal in a comparison, a case label or a literal type: name the enum member or use its type.',
    },
    schema: [{
      type: 'object',
      properties: { baseline: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } } },
      additionalProperties: false,
    }],
    messages: {
      enumLiteral:
        "'{{value}}' is a value of {{enumNames}}. Name the member (for example {{enumName}}.{{value}}) or use the enum's type instead of the string (rules/domain-model-conventions-rules.md §17). A string that only happens to match takes \"// poolmaster-allow-enum-literal: <reason>\".",
      missingReason: 'poolmaster-allow-enum-literal needs a reason: "// poolmaster-allow-enum-literal: <why this string is not the enum value>".',
      unusedAllow: 'This poolmaster-allow-enum-literal marker excuses nothing; delete it.',
      overBaseline:
        "'{{value}}' ({{enumNames}}) — this file has {{found}} enum string literals and eslint-rules/enum-string-literal-baseline.json allows {{allowed}}. Remove the new one: name the enum member.",
    },
  },
  create(context) {
    const baseline = context.options[0]?.baseline ?? {};
    const file = relative(context.cwd, context.filename).split(sep).join('/');
    const allowed = baseline[file] ?? 0;
    const values = sharedEnumValues(context.cwd);
    const allow = allowMarkers(context, 'poolmaster-allow-enum-literal');
    const hits = [];

    return {
      Literal(node) {
        if (typeof node.value !== 'string' || !values.has(node.value) || !isJudgedPosition(node)) return;
        if (allow.covers(node)) return;
        const names = values.get(node.value);
        const enumNames = names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(' or ');
        hits.push({ node, data: { value: node.value, enumName: names[0], enumNames } });
      },
      'Program:exit'() {
        allow.reportUnused();
        if (hits.length <= allowed) return;
        for (const { node, data } of hits) {
          if (allowed === 0) context.report({ node, messageId: 'enumLiteral', data });
          else context.report({ node, messageId: 'overBaseline', data: { ...data, found: String(hits.length), allowed: String(allowed) } });
        }
      },
    };
  },
};
