/**
 * A type name under `features/**` must be declared in exactly one file.
 *
 * WHAT THIS CATCHES THAT `no-parallel-api-types` DOES NOT. That rule is name-based
 * against the GENERATED type names, so it only sees a local type that shadows a
 * generated one. It cannot see a local type invented under a fresh name and then
 * copy-pasted across pages — which is the actual shape of the problem here (#87).
 *
 * Measured before writing this: 20 names are declared in more than one file, across
 * 71 declaration sites. They are not hand-guessed shapes — they are DERIVED from
 * generated types, which is the right instinct. The defect is that the derivation is
 * duplicated and the copies disagree:
 *
 *   LeagueDetail  GetLeagueByCodeResponses[200]['league']              x7
 *                 GetLeagueResponses[200]['league']                    x3
 *   GolfSeason    AdminGetGolfSeasonResponses[200]['season']           x3
 *                 AdminListGolfSeasonsResponses[200]['seasons'][number] x5
 *
 * A get-one response and a list item are different shapes — list items normally carry
 * fewer fields. So `GolfSeason` names a richer type in some files than others, and a
 * developer moving between them gets a different type with no signal. That is the
 * "semantic misuse of DTO state" #87 was filed for.
 *
 * WHY NOT "ban declarations in the data-access layer", which was the agreed approach:
 * there is no data-access layer to scope to. 39 of the ~52 files calling useQuery /
 * useMutation are `*-page.tsx`; queries live directly in page components. Banning type
 * declarations there would hit 86 sites, most of them legitimate view-models.
 *
 * Per-component types are exempt by suffix: a `Props`/`State`/`FormValues` type is
 * per-component by nature and repeating the name is not duplication.
 *
 * The fix pattern already exists and simply is not used consistently —
 * `features/leagues/league-cache.ts` exports `LeagueDetail` and `LeagueSummary` as
 * canonical derivations.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const FEATURES_ROOT = 'clients/poolmaster/src/features';
const PER_COMPONENT_SUFFIX = /(Props|State|FormValues|FormState|Handlers)$/;
// Anchored with NO leading whitespace on purpose: this pre-scan must agree with the
// AST check below, which only reports TOP-LEVEL declarations. Allowing indentation
// made the scan match nested and commented-out declarations the AST pass never sees,
// which over-reported by 32 findings across 32 phantom names.
const DECLARATION = /^(?:export\s+)?(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm;
const SKIP_FILE = /\.(test|spec)\.tsx?$/;

let cache = null;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !SKIP_FILE.test(full)) out.push(full);
  }
  return out;
}

/** name -> sorted list of files declaring it, for names declared more than once. */
function duplicateDeclarations(cwd) {
  if (cache !== null) return cache;
  const byName = new Map();
  try {
    for (const file of walk(resolve(cwd, FEATURES_ROOT))) {
      const text = readFileSync(file, 'utf8');
      DECLARATION.lastIndex = 0;
      for (const m of text.matchAll(DECLARATION)) {
        if (PER_COMPONENT_SUFFIX.test(m[1])) continue;
        if (!byName.has(m[1])) byName.set(m[1], new Set());
        byName.get(m[1]).add(relative(resolve(cwd), file).split(sep).join('/'));
      }
    }
  } catch {
    cache = new Map();
    return cache;
  }
  cache = new Map();
  for (const [name, files] of byName) {
    if (files.size > 1) cache.set(name, [...files].sort());
  }
  return cache;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'A feature type name must be declared in exactly one file.',
    },
    schema: [],
    messages: {
      duplicateType:
        '`{{name}}` is declared in {{count}} files ({{files}}). Declare it once and import it — '
        + 'duplicated derivations drift, and two of these already name different response shapes '
        + 'under one name.',
    },
  },
  create(context) {
    const dupes = duplicateDeclarations(context.cwd || process.cwd());
    if (dupes.size === 0) return {};

    function check(node) {
      if (!node.id || node.id.type !== 'Identifier') return;
      // Top-level only, matching the pre-scan. A type declared inside a function or
      // a namespace is scoped there and repeating its name is not duplication.
      const parent = node.parent;
      const isTopLevel =
        parent
        && (parent.type === 'Program'
          || (parent.type === 'ExportNamedDeclaration'
            && parent.parent
            && parent.parent.type === 'Program'));
      if (!isTopLevel) return;
      const name = node.id.name;
      if (PER_COMPONENT_SUFFIX.test(name)) return;
      const files = dupes.get(name);
      if (!files) return;
      context.report({
        node: node.id,
        messageId: 'duplicateType',
        data: {
          name,
          count: String(files.length),
          files: files.map((f) => f.replace('clients/poolmaster/src/', '')).join(', '),
        },
      });
    }

    return {
      TSTypeAliasDeclaration: check,
      TSInterfaceDeclaration: check,
    };
  },
};
