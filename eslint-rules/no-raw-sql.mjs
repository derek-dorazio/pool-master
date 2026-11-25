/**
 * No raw SQL in production source unless a reviewed marker says what Prisma cannot express
 * (#2113; rules/service-rules.md §5 *Prisma and Persistence*).
 *
 * Prisma's query API is how this codebase reads and writes. A few things it cannot say: a row
 * lock (`SELECT … FOR UPDATE`), a queue claimed with `SKIP LOCKED`, a Postgres advisory lock, a
 * set-based update from `unnest` arrays or an `array_remove` across rows. Each such call to
 * `$queryRaw` or `$executeRaw` takes `// poolmaster-allow-raw-sql: <what Prisma can't express>` on
 * the line before. `$queryRawUnsafe` and `$executeRawUnsafe` build SQL from strings and are never
 * excused.
 *
 * The markers are counted per file (`eslint-rules/raw-sql-baseline.json`). The baseline ratchet
 * refuses a new one unless `scripts/baseline-raises.json` declares it with its reason, so every
 * new raw query is seen by a reviewer.
 */
import { relative, sep } from 'node:path';

import { allowMarkers } from './allow-markers.mjs';

const RAW = new Set(['$queryRaw', '$executeRaw']);
const UNSAFE = new Set(['$queryRawUnsafe', '$executeRawUnsafe']);

function rawMethod(node) {
  if (node.type !== 'MemberExpression' || node.computed || node.property.type !== 'Identifier') return null;
  return RAW.has(node.property.name) || UNSAFE.has(node.property.name) ? node.property.name : null;
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'No raw SQL unless a reviewed poolmaster-allow-raw-sql marker says what Prisma cannot express; the Unsafe forms never.' },
    schema: [{
      type: 'object',
      properties: { baseline: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } } },
      additionalProperties: false,
    }],
    messages: {
      rawSql:
        '{{method}} is raw SQL. Use the Prisma query API; where it cannot express the query (a row lock, a SKIP LOCKED queue, an advisory lock, a set-based update), add "// poolmaster-allow-raw-sql: <what Prisma can\'t express>" and declare the raise in scripts/baseline-raises.json (rules/service-rules.md §5).',
      unsafe: '{{method}} builds SQL from a string and is never allowed: use the tagged-template $queryRaw / $executeRaw with a marker instead.',
      missingReason: 'poolmaster-allow-raw-sql needs a reason: "// poolmaster-allow-raw-sql: <what Prisma can\'t express>".',
      unusedAllow: 'This poolmaster-allow-raw-sql marker excuses nothing; delete it.',
      overBaseline:
        '{{method}} — this file has {{found}} raw SQL markers and eslint-rules/raw-sql-baseline.json allows {{allowed}}. A new raw query is declared in scripts/baseline-raises.json with its reason, so a reviewer sees it.',
    },
  },
  create(context) {
    const baseline = context.options[0]?.baseline ?? {};
    const file = relative(context.cwd, context.filename).split(sep).join('/');
    const allowed = baseline[file] ?? 0;
    const allow = allowMarkers(context, 'poolmaster-allow-raw-sql');
    const marked = [];

    function check(node, callee) {
      const method = rawMethod(callee);
      if (!method) return;
      if (UNSAFE.has(method)) {
        context.report({ node, messageId: 'unsafe', data: { method } });
        return;
      }
      if (allow.covers(node)) marked.push({ node, method });
      else context.report({ node, messageId: 'rawSql', data: { method } });
    }

    return {
      TaggedTemplateExpression(node) {
        check(node, node.tag.type === 'TSInstantiationExpression' ? node.tag.expression : node.tag);
      },
      CallExpression(node) {
        check(node, node.callee);
      },
      'Program:exit'() {
        allow.reportUnused();
        if (marked.length <= allowed) return;
        for (const { node, method } of marked) {
          context.report({ node, messageId: 'overBaseline', data: { method, found: String(marked.length), allowed: String(allowed) } });
        }
      },
    };
  },
};
