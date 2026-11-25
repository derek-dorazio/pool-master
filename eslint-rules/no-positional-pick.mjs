/**
 * No domain item picked by its position when the model gives it a meaning (#2115;
 * rules/domain-model-conventions-rules.md §17 *Rules Live In The Model, Not In Code*).
 *
 * `rounds.at(-1)` as the final, `games[0]` as game 1 and `events.at(0)` as the contest's event
 * all assume an order the model never promised. The model names each one: a slot kind, a round
 * or game number, a phase, the covered slot. Read that field instead.
 *
 * Reported, on a member or variable named `rounds`, `slots`, `phases`, `events`, `games`,
 * `matches`, `sides`, `seasons`, `regions` or `fieldRows`: an index with a literal (`[0]`),
 * `.at(n)` with a literal, and `[x.length - 1]`. Iterating, mapping and destructuring are not.
 *
 * Position is fine only when the order is the meaning: the first item after sorting by a
 * declared field (the earliest by `startsAt`), or the one row a nested create wrote. Such a read
 * takes `// poolmaster-allow-position: <the order it relies on>` on the line before.
 *
 * Grandfathered files sit on a shrink-only count (`eslint-rules/positional-pick-baseline.json`).
 */
import { relative, sep } from 'node:path';

import { allowMarkers } from './allow-markers.mjs';

const DOMAIN_LISTS = new Set(['rounds', 'slots', 'phases', 'events', 'games', 'matches', 'sides', 'seasons', 'regions', 'fieldRows']);

/** The name a list is read through: `rounds` in `rounds[0]` and in `league.rounds[0]`. */
function listName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') return node.property.name;
  return null;
}

function isNumberLiteral(node) {
  if (node.type === 'Literal' && typeof node.value === 'number') return true;
  return node.type === 'UnaryExpression' && node.operator === '-' && node.argument.type === 'Literal' && typeof node.argument.value === 'number';
}

function isLastIndex(node) {
  return node.type === 'BinaryExpression' && node.operator === '-' && node.left.type === 'MemberExpression'
    && !node.left.computed && node.left.property.type === 'Identifier' && node.left.property.name === 'length';
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'No domain item picked by array position: read the field the model gives it (slot kind, round or game number, phase).' },
    schema: [{
      type: 'object',
      properties: { baseline: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } } },
      additionalProperties: false,
    }],
    messages: {
      positionalPick:
        '{{pick}} picks a {{list}} item by its position. Read the field the model gives it (a slot kind, a round or game number, a phase, the covered slot) instead (rules/domain-model-conventions-rules.md §17). Where the order is the meaning, add "// poolmaster-allow-position: <the order it relies on>".',
      missingReason: 'poolmaster-allow-position needs a reason: "// poolmaster-allow-position: <the order it relies on>".',
      unusedAllow: 'This poolmaster-allow-position marker excuses nothing; delete it.',
      overBaseline:
        '{{pick}} — this file has {{found}} positional picks and eslint-rules/positional-pick-baseline.json allows {{allowed}}. Remove the new one: read the field the model gives it.',
    },
  },
  create(context) {
    const baseline = context.options[0]?.baseline ?? {};
    const file = relative(context.cwd, context.filename).split(sep).join('/');
    const allowed = baseline[file] ?? 0;
    const allow = allowMarkers(context, 'poolmaster-allow-position');
    const hits = [];

    function hit(node, list) {
      if (allow.covers(node)) return;
      hits.push({ node, data: { list, pick: context.sourceCode.getText(node) } });
    }

    return {
      MemberExpression(node) {
        if (!node.computed) return;
        const list = listName(node.object);
        if (!list || !DOMAIN_LISTS.has(list)) return;
        if (isNumberLiteral(node.property) || isLastIndex(node.property)) hit(node, list);
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier' || callee.property.name !== 'at') return;
        const list = listName(callee.object);
        if (!list || !DOMAIN_LISTS.has(list) || node.arguments.length !== 1 || !isNumberLiteral(node.arguments[0])) return;
        hit(node, list);
      },
      'Program:exit'() {
        allow.reportUnused();
        if (hits.length <= allowed) return;
        for (const { node, data } of hits) {
          if (allowed === 0) context.report({ node, messageId: 'positionalPick', data });
          else context.report({ node, messageId: 'overBaseline', data: { ...data, found: String(hits.length), allowed: String(allowed) } });
        }
      },
    };
  },
};
