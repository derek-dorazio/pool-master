/**
 * The web app uses the generated contract types instead of writing local copies of them (#2107;
 * rules/react-ui-rules.md §3 *API Integration*).
 *
 * `no-parallel-api-types` catches a local type that takes a generated type's name. A copy under
 * another name slips past it: `interface ContestRow { id; name; status; startsAt }` restates
 * `ContestSummaryDto` and drifts from it at the next `npm run api:refresh`, because nothing
 * compares the two. This rule compares field names: a local `interface`, or a `type` that is an
 * object literal, is reported when it has at least 3 fields and 75% or more of them (at least 3)
 * are fields of one generated hey-api type. Component props (`…Props`) are left alone.
 *
 * The fix is the DTO itself, `Pick<Dto, …>`, or a field the API adds. A shape that only happens to
 * share field names (a form's values, a chart point) takes
 * `// poolmaster-allow-dto-shape: <reason>` on the line before.
 *
 * Grandfathered files sit on a shrink-only count (`eslint-rules/dto-shape-baseline.json`).
 * The generated file is read once per lint process; a checkout without it reports nothing, since
 * `api:check` owns that failure.
 */
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

import { allowMarkers } from './allow-markers.mjs';

const GENERATED_TYPES_PATH = 'packages/shared/generated/hey-api/types.gen.ts';
const BLOCK = /^export type (\w+) = \{\n([\s\S]*?)^\};/gm;
const TOP_FIELD = /^ {4}['"]?([A-Za-z_$][\w$]*)['"]?\??:/;
const MIN_FIELDS = 3;
const MIN_SHARE = 0.75;

let cache = null;

/** Each generated object type's top-level field names, for types with at least 3 fields. */
export function generatedShapes(cwd) {
  if (cache !== null) return cache;
  const shapes = [];
  try {
    const text = readFileSync(resolve(cwd, GENERATED_TYPES_PATH), 'utf8');
    for (const [, name, body] of text.matchAll(BLOCK)) {
      const fields = new Set(body.split('\n').map((line) => line.match(TOP_FIELD)?.[1]).filter(Boolean));
      if (fields.size >= MIN_FIELDS) shapes.push({ name, fields });
    }
  } catch {
    // No generated file in this checkout; api:check owns that failure.
  }
  cache = shapes;
  return shapes;
}

/** The generated type a set of local field names copies most closely, or null below the threshold. */
export function closestShape(fields, shapes) {
  if (fields.length < MIN_FIELDS) return null;
  let best = null;
  for (const shape of shapes) {
    const shared = fields.filter((field) => shape.fields.has(field)).length;
    const share = shared / fields.length;
    if (shared >= MIN_FIELDS && share >= MIN_SHARE && (!best || share > best.share)) best = { name: shape.name, shared, share };
  }
  return best;
}

function fieldNames(members) {
  return members
    .filter((member) => member.type === 'TSPropertySignature' && !member.computed)
    .map((member) => (member.key.type === 'Identifier' ? member.key.name : String(member.key.value)));
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'No local interface or object type in the web app that copies a generated hey-api type: use the DTO, Pick<> or a field the API adds.',
    },
    schema: [{
      type: 'object',
      properties: { baseline: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } } },
      additionalProperties: false,
    }],
    messages: {
      dtoCopy:
        '{{local}} copies {{shared}} of its {{total}} fields from the generated {{dto}}. Use {{dto}}, Pick<{{dto}}, …> or a field the API adds (rules/react-ui-rules.md §3). A shape that only shares names takes "// poolmaster-allow-dto-shape: <reason>".',
      overBaseline:
        '{{local}} (copies {{dto}}) — this file has {{found}} DTO-shaped local types and eslint-rules/dto-shape-baseline.json allows {{allowed}}. Remove the new one: use the generated type.',
      missingReason: 'poolmaster-allow-dto-shape needs a reason: "// poolmaster-allow-dto-shape: <why this is not a copy of the DTO>".',
      unusedAllow: 'This poolmaster-allow-dto-shape marker excuses nothing; delete it.',
    },
  },
  create(context) {
    const baseline = context.options[0]?.baseline ?? {};
    const file = relative(context.cwd, context.filename).split(sep).join('/');
    const allowed = baseline[file] ?? 0;
    const shapes = generatedShapes(context.cwd);
    const allow = allowMarkers(context, 'poolmaster-allow-dto-shape');
    const hits = [];

    function check(node, name, members) {
      if (/Props$/.test(name)) return;
      const fields = fieldNames(members);
      const match = closestShape(fields, shapes);
      if (!match || allow.covers(node)) return;
      hits.push({ node, data: { local: name, dto: match.name, shared: String(match.shared), total: String(fields.length) } });
    }

    return {
      TSInterfaceDeclaration(node) {
        check(node, node.id.name, node.body.body);
      },
      TSTypeAliasDeclaration(node) {
        if (node.typeAnnotation.type === 'TSTypeLiteral') check(node, node.id.name, node.typeAnnotation.members);
      },
      'Program:exit'() {
        allow.reportUnused();
        if (hits.length <= allowed) return;
        for (const { node, data } of hits) {
          if (allowed === 0) context.report({ node, messageId: 'dtoCopy', data });
          else context.report({ node, messageId: 'overBaseline', data: { ...data, found: String(hits.length), allowed: String(allowed) } });
        }
      },
    };
  },
};
