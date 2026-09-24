/**
 * A field that the Prisma schema declares as an enum must not be re-declared as
 * `string` in a hand-written type.
 *
 * WHY THIS, AND NOT A RULE ABOUT STRING LITERALS. #86 was written as "ban bare
 * lifecycle literals." Measuring first showed that framing targets the weaker half:
 * `tsc` ALREADY rejects an invalid literal on an enum-typed field (TS2367, verified
 * by planting one). What it cannot catch is a hand-written row type that widens the
 * column to `string` — and that widening is what forces the cast back:
 *
 *     export interface SportRow { participantType: string; }        // widened
 *     participantType: row.participantType as ParticipantType,      // cast back
 *
 * 16 unchecked casts to domain enum types existed in packages/core-api/src for
 * exactly this reason. The cast is the defect; the widening is its cause.
 *
 * The enum-backed field names are read from schema.prisma once per lint process,
 * the same shape as `no-parallel-api-types`. A schema change therefore changes what
 * this rule flags with no edit here.
 *
 * ONLY UNAMBIGUOUS FIELD NAMES ARE FLAGGED. A name counts only when EVERY model that
 * declares it types it as an enum. `status` is deliberately excluded today: it is an
 * enum on SportEvent, LeagueMembership, LeagueInvitation and Participant, but plain
 * `String` on Contest, ContestEntry, DraftSession, IngestionJob, ProviderSyncRun and
 * MigrationRun. A hand-written row type does not say which model it mirrors, so
 * flagging `status: string` would be wrong wherever the schema itself says `String`.
 *
 * This is self-expanding rather than a permanent carve-out: when those columns become
 * enums (the deferred schema work), `status` becomes unambiguous and the rule starts
 * covering it with no edit here. That is the whole reason the rule reads the schema
 * instead of hardcoding a list.
 *
 * DELIBERATELY NOT FLAGGED — integration boundaries, per
 * `domain-model-conventions-rules.md` *Guiding Principle*: "the only acceptable use
 * of opaque shapes is at integration boundaries where the shape genuinely cannot be
 * enforced." A parsed CSV row, an unvalidated HTTP request body, and a presentational
 * prop carrying a display label ("Root admin") are all genuinely `string` until
 * something validates them. Those are opted out by path via `ignores` in
 * eslint.config.js, not by weakening the rule.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCHEMA_PATH = 'packages/core-api/prisma/schema.prisma';

let cache = null;

/** Field names that schema.prisma declares with an enum type, on any model. */
function enumBackedFields(cwd) {
  if (cache !== null) return cache;
  const result = new Map();
  try {
    const text = readFileSync(resolve(cwd, SCHEMA_PATH), 'utf8');
    const enums = new Set(
      [...text.matchAll(/^enum\s+(\w+)\s*\{/gm)].map((m) => m[1]),
    );
    for (const model of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      for (const line of model[2].split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('//') || t.startsWith('@@')) continue;
        const parts = t.split(/\s+/);
        if (parts.length < 2) continue;
        const type = parts[1].replace(/[?[\]]/g, '');
        if (!result.has(parts[0])) result.set(parts[0], { enums: new Set(), widened: false });
        const entry = result.get(parts[0]);
        if (enums.has(type)) entry.enums.add(type);
        else if (type === 'String') entry.widened = true;
      }
    }
    // Keep only names that are an enum on EVERY model declaring them.
    for (const [name, entry] of result) {
      if (entry.enums.size === 0 || entry.widened) result.delete(name);
      else result.set(name, entry.enums);
    }
    cache = result;
  } catch {
    // No schema in this checkout; nothing to enforce.
    cache = new Map();
  }
  return cache;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Do not re-declare an enum-backed schema column as `string` in a hand-written type.',
    },
    schema: [],
    messages: {
      widenedEnum:
        '`{{name}}` is {{enums}} in schema.prisma. Declaring it `string` here discards the '
        + 'guarantee the schema already gives and forces an unchecked `as` cast downstream. '
        + 'Use the domain enum type. If this is a genuine integration boundary (parsed CSV, '
        + 'unvalidated request body, display label), opt the path out in eslint.config.js.',
    },
  },
  create(context) {
    const fields = enumBackedFields(context.cwd || process.cwd());
    if (fields.size === 0) return {};

    function check(node) {
      const key = node.key;
      const name =
        key && key.type === 'Identifier' ? key.name
          : key && key.type === 'Literal' && typeof key.value === 'string' ? key.value
            : null;
      if (name === null || !fields.has(name)) return;
      const ann = node.typeAnnotation && node.typeAnnotation.typeAnnotation;
      if (!ann || ann.type !== 'TSStringKeyword') return;
      context.report({
        node,
        messageId: 'widenedEnum',
        data: { name, enums: [...fields.get(name)].join(' / ') },
      });
    }

    return {
      TSPropertySignature: check,
    };
  },
};
