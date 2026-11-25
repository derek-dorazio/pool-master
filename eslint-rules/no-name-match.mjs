/**
 * No domain row looked up by its name (#2114; rules/domain-model-conventions-rules.md §17
 * *Never match on a name*).
 *
 * A name is display text: it is renamed, translated and duplicated. A row is found by its id,
 * code or key. Reported in production source:
 *
 * - `name: { equals: … }` in a Prisma `where`;
 * - a `.find`, `.filter`, `.some`, `.every` or `.findIndex` callback that compares `.name` or
 *   `.label` (or its `toLowerCase()` / `toUpperCase()`) with `===` or `!==`;
 * - `===` / `!==` between two `.name` members.
 *
 * Not reported: free-text search (`contains`, `startsWith`), an update that writes a name, an
 * error's `.name`, and a DOM event target's `.name`. Code that compares a provider's name with
 * the stored one to update it, or any other comparison that is not a lookup, takes
 * `// poolmaster-allow-name-match: <reason>` on the line before.
 *
 * Grandfathered files sit on a shrink-only count (`eslint-rules/name-match-baseline.json`).
 */
import { relative, sep } from 'node:path';

import { allowMarkers } from './allow-markers.mjs';

const CALLBACKS = new Set(['find', 'filter', 'some', 'every', 'findIndex', 'findLast']);
const NAMES = new Set(['name', 'label']);
const CASE = new Set(['toLowerCase', 'toUpperCase', 'toLocaleLowerCase', 'toLocaleUpperCase', 'trim']);
const NOT_DOMAIN = /^(e|err|error|exception|cause|target|currentTarget|input|element|el)$/i;

/** The `.name` / `.label` member a side of a comparison reads, through any case change, or null. */
function nameMember(node, names = NAMES) {
  let current = node;
  while (current.type === 'CallExpression' && current.callee.type === 'MemberExpression' && !current.callee.computed
    && CASE.has(current.callee.property.name) && current.arguments.length === 0) {
    current = current.callee.object;
  }
  if (current.type === 'ChainExpression') current = current.expression;
  if (current.type !== 'MemberExpression' || current.computed || current.property.type !== 'Identifier') return null;
  if (!names.has(current.property.name)) return null;
  const owner = current.object.type === 'MemberExpression' && !current.object.computed ? current.object.property : current.object;
  if (owner.type === 'Identifier' && NOT_DOMAIN.test(owner.name)) return null;
  return current;
}

function insideLookupCallback(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'ArrowFunctionExpression' || current.type === 'FunctionExpression') {
      const call = current.parent;
      return call?.type === 'CallExpression' && call.arguments[0] === current && call.callee.type === 'MemberExpression'
        && !call.callee.computed && CALLBACKS.has(call.callee.property.name);
    }
  }
  return false;
}

function insideWhere(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'Property' && !current.computed && current.key.type === 'Identifier' && current.key.name === 'where') return true;
  }
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'No domain row looked up by its name: find it by id, code or key.' },
    schema: [{
      type: 'object',
      properties: { baseline: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } } },
      additionalProperties: false,
    }],
    messages: {
      nameMatch:
        '{{what}} finds a row by its name. A name is display text: find the row by its id, code or key (rules/domain-model-conventions-rules.md §17). A comparison that is not a lookup takes "// poolmaster-allow-name-match: <reason>".',
      missingReason: 'poolmaster-allow-name-match needs a reason: "// poolmaster-allow-name-match: <why this is not a lookup by name>".',
      unusedAllow: 'This poolmaster-allow-name-match marker excuses nothing; delete it.',
      overBaseline:
        '{{what}} — this file has {{found}} name matches and eslint-rules/name-match-baseline.json allows {{allowed}}. Remove the new one: find the row by its id, code or key.',
    },
  },
  create(context) {
    const baseline = context.options[0]?.baseline ?? {};
    const file = relative(context.cwd, context.filename).split(sep).join('/');
    const allowed = baseline[file] ?? 0;
    const allow = allowMarkers(context, 'poolmaster-allow-name-match');
    const hits = [];
    const hit = (node) => {
      if (!allow.covers(node)) hits.push({ node, what: context.sourceCode.getText(node).split('\n')[0].slice(0, 80) });
    };

    return {
      Property(node) {
        if (node.computed || node.key.type !== 'Identifier' || node.key.name !== 'name' || node.value.type !== 'ObjectExpression') return;
        const equals = node.value.properties.some((p) => p.type === 'Property' && !p.computed && p.key.type === 'Identifier' && p.key.name === 'equals');
        if (equals && insideWhere(node)) hit(node);
      },
      BinaryExpression(node) {
        if (node.operator !== '===' && node.operator !== '!==') return;
        // A presence check (`name === undefined`, `label !== ''`) reads no other row.
        if ([node.left, node.right].some((side) => (side.type === 'Identifier' && side.name === 'undefined') || (side.type === 'Literal' && (side.value === null || side.value === '')))) return;
        const left = nameMember(node.left);
        const right = nameMember(node.right);
        const bothNames = nameMember(node.left, new Set(['name'])) && nameMember(node.right, new Set(['name']));
        if (bothNames || ((left || right) && insideLookupCallback(node))) hit(node);
      },
      'Program:exit'() {
        allow.reportUnused();
        if (hits.length <= allowed) return;
        for (const { node, what } of hits) {
          if (allowed === 0) context.report({ node, messageId: 'nameMatch', data: { what } });
          else context.report({ node, messageId: 'overBaseline', data: { what, found: String(hits.length), allowed: String(allowed) } });
        }
      },
    };
  },
};
