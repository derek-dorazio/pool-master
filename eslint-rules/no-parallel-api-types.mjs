/**
 * Replaces scripts/check-no-parallel-api-types.mjs.
 *
 * A local `interface League {...}` that shadows a generated hey-api type is how a
 * frontend drifts off the contract: the two shapes agree on the day they are written
 * and diverge silently at the next `npm run api:refresh`, because nothing compares
 * them. The generated names are the contract; a hand-written type wearing one of them
 * is a second source of truth.
 *
 * Unlike the other migrated rules, this one needs state the AST does not carry: the
 * set of names the generator currently emits. It is read from
 * `packages/shared/generated/hey-api/types.gen.ts` once per lint process and cached,
 * so a refresh that renames a type changes what the rule flags without any edit here.
 *
 * The read is lazy and failure-tolerant on purpose. A checkout that has not run
 * `npm run api:refresh` has no generated file, and a rule that throws there would
 * fail lint for a reason that has nothing to do with the code being linted --
 * `api:check` is the gate that owns generated-file freshness, and it is blocking.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GENERATED_TYPES_PATH = 'packages/shared/generated/hey-api/types.gen.ts';

// Matches the exported declarations the generator emits. It emits a flat file of
// `export type X = ...` and `export interface X {...}` with no nesting, so a line
// scan reads exactly what the scanner's AST walk did -- confirmed by diffing the
// two name sets before this rule replaced it.
const DECLARATION = /^export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm;

let cache = null;

function generatedTypeNames(cwd) {
  if (cache !== null) return cache;
  try {
    const text = readFileSync(resolve(cwd, GENERATED_TYPES_PATH), 'utf8');
    const names = new Set();
    for (const match of text.matchAll(DECLARATION)) names.add(match[1]);
    cache = names;
  } catch {
    // No generated file in this checkout; api:check owns that failure.
    cache = new Set();
  }
  return cache;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Frontend types must not shadow generated hey-api names; import the generated type.',
    },
    schema: [],
    messages: {
      parallelType:
        'Local type "{{name}}" duplicates a generated hey-api type. Import it from the '
        + 'generated client instead — a hand-written copy agrees on the day it is written '
        + 'and drifts silently at the next api:refresh.',
    },
  },
  create(context) {
    const names = generatedTypeNames(context.cwd || process.cwd());
    if (names.size === 0) return {};

    function check(node) {
      if (node.id && node.id.type === 'Identifier' && names.has(node.id.name)) {
        context.report({
          node: node.id,
          messageId: 'parallelType',
          data: { name: node.id.name },
        });
      }
    }

    return {
      TSTypeAliasDeclaration: check,
      TSInterfaceDeclaration: check,
    };
  },
};
