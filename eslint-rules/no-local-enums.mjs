/**
 * The web app declares no enums of its own (#2107; rules/domain-model-conventions-rules.md §17
 * *Rules Live In The Model, Not In Code*).
 *
 * The contract's enums are generated into the shared package, with their values, order and labels.
 * A local `enum`, or a `const` object whose every value is an upper-case code
 * (`{ INCLUDED: 'INCLUDED', LOCKED: 'LOCKED' }`), is a second set of codes the API never sees:
 * either it copies a shared enum, or it is a domain state the API should name. Use the shared
 * enum, or a field the API adds. A pure layout choice (which tab is open) is a union of
 * lower-case display keys, not codes.
 *
 * A set of codes that is not domain (a third-party library's constants) takes
 * `// poolmaster-allow-local-enum: <reason>` on the line before.
 *
 * Grandfathered files sit on a shrink-only count (`eslint-rules/local-enum-baseline.json`).
 */
import { relative, sep } from 'node:path';

import { allowMarkers } from './allow-markers.mjs';

const CODE = /^[A-Z][A-Z0-9_]*$/;

function isCodeObject(init) {
  let node = init;
  while (node && (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression')) node = node.expression;
  if (!node || node.type !== 'ObjectExpression' || node.properties.length < 2) return false;
  // Computed keys (`[SportEventStatus.DRAFT]: 'DRAFT_LABEL'`) map a shared enum to keys; that is a lookup, not new codes.
  return node.properties.every(
    (property) => property.type === 'Property' && !property.computed && property.value.type === 'Literal' && typeof property.value.value === 'string' && CODE.test(property.value.value),
  );
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'No enum declared in the web app: use the shared enum or a field the API adds.' },
    schema: [{
      type: 'object',
      properties: { baseline: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } } },
      additionalProperties: false,
    }],
    messages: {
      localEnum:
        '{{name}} declares codes of its own. The contract\'s enums come from the shared package: use the shared enum, or a field the API adds (rules/domain-model-conventions-rules.md §17).',
      missingReason: 'poolmaster-allow-local-enum needs a reason: "// poolmaster-allow-local-enum: <why these codes are not domain>".',
      unusedAllow: 'This poolmaster-allow-local-enum marker excuses nothing; delete it.',
      overBaseline:
        '{{name}} — this file has {{found}} local enums and eslint-rules/local-enum-baseline.json allows {{allowed}}. Remove the new one: use the shared enum.',
    },
  },
  create(context) {
    const baseline = context.options[0]?.baseline ?? {};
    const file = relative(context.cwd, context.filename).split(sep).join('/');
    const allowed = baseline[file] ?? 0;
    const allow = allowMarkers(context, 'poolmaster-allow-local-enum');
    const hits = [];

    return {
      TSEnumDeclaration(node) {
        if (allow.covers(node)) return;
        hits.push({ node, name: node.id.name });
      },
      VariableDeclarator(node) {
        if (node.parent.kind !== 'const' || node.id.type !== 'Identifier' || !isCodeObject(node.init) || allow.covers(node)) return;
        hits.push({ node, name: node.id.name });
      },
      'Program:exit'() {
        allow.reportUnused();
        if (hits.length <= allowed) return;
        for (const { node, name } of hits) {
          if (allowed === 0) context.report({ node, messageId: 'localEnum', data: { name } });
          else context.report({ node, messageId: 'overBaseline', data: { name, found: String(hits.length), allowed: String(allowed) } });
        }
      },
    };
  },
};
