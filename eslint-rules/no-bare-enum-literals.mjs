/**
 * A comparison against an enum-backed column must name the enum member, not a bare
 * string literal: `x.syncScope === SportEventSyncScope.FULL`, not `=== 'FULL'`.
 *
 * SCOPE, AND WHY IT IS NARROW. `tsc` already rejects an INVALID literal here (TS2367,
 * verified) — so this rule is not about preventing bad values. It is about the rename:
 * a bare literal does not follow when an enum member is renamed, and nothing reports
 * the resulting dead branch. That is a smaller claim than #86's original "risk/high"
 * framing, and the rule is scoped to match it.
 *
 * Like `no-widened-enum-fields`, this reads schema.prisma at config load and only
 * considers field names that are an enum on EVERY model declaring them. `status` is
 * excluded today because it is `String` on six models — a literal comparison there
 * has no enum to name. When #186 converts those columns, both rules widen with no
 * edit here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCHEMA_PATH = 'packages/core-api/prisma/schema.prisma';
let cache = null;

/** field name -> Set of member values, for unambiguously-enum-backed columns. */
function enumBackedMembers(cwd) {
  if (cache !== null) return cache;
  const out = new Map();
  try {
    const text = readFileSync(resolve(cwd, SCHEMA_PATH), 'utf8');
    const enums = new Map();
    for (const m of text.matchAll(/^enum\s+(\w+)\s*\{([^}]*)\}/gm)) {
      enums.set(m[1], m[2].split('\n').map((l) => l.trim())
        .filter((l) => l && !l.startsWith('//')).map((l) => l.split(/\s+/)[0]));
    }
    const byField = new Map();
    for (const model of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      for (const line of model[2].split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('//') || t.startsWith('@@')) continue;
        const p = t.split(/\s+/);
        if (p.length < 2) continue;
        const type = p[1].replace(/[?[\]]/g, '');
        if (!byField.has(p[0])) byField.set(p[0], { members: new Set(), widened: false });
        const e = byField.get(p[0]);
        if (enums.has(type)) for (const v of enums.get(type)) e.members.add(v);
        else if (type === 'String') e.widened = true;
      }
    }
    for (const [name, e] of byField) {
      if (e.members.size > 0 && !e.widened) out.set(name, e.members);
    }
    cache = out;
  } catch {
    cache = new Map();
  }
  return cache;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Compare enum-backed columns against the enum member, not a bare string literal.',
    },
    schema: [],
    messages: {
      bareLiteral:
        "`{{field}}` is an enum column; compare against the enum member rather than '{{value}}'. "
        + 'A bare literal does not follow an enum rename, and the dead branch it leaves is not reported.',
    },
  },
  create(context) {
    const fields = enumBackedMembers(context.cwd || process.cwd());
    if (fields.size === 0) return {};

    return {
      BinaryExpression(node) {
        if (node.operator !== '===' && node.operator !== '!==') return;
        for (const [a, b] of [[node.left, node.right], [node.right, node.left]]) {
          if (a.type !== 'MemberExpression' || a.computed) continue;
          if (a.property.type !== 'Identifier') continue;
          const members = fields.get(a.property.name);
          if (!members) continue;
          if (b.type !== 'Literal' || typeof b.value !== 'string') continue;
          if (!members.has(b.value)) continue;
          context.report({
            node,
            messageId: 'bareLiteral',
            data: { field: a.property.name, value: b.value },
          });
          return;
        }
      },
    };
  },
};
