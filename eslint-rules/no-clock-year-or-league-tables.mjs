/**
 * Banned: working out a year from a date, and a table of facts keyed by league, sport or
 * Season in code (#1927; `rules/domain-model-conventions-rules.md` §17 *Rules Live In The Model,
 * Not In Code*).
 *
 * The current year or season is one fact: the league's current Season, its `championshipYear`,
 * or the provider's own season id, read from the model or the API. Every `getFullYear()` that
 * turned today's date into a season (five rollover-month rules, a "years ahead" list, a World
 * Cup edition cycle) had passed review, because each looked like ordinary date code. The same
 * holds for a `Record<Sport, …>` or a `Map<LeagueCode, …>` of numbers, names or months: a fact
 * about particular leagues kept where the next league has to find it.
 *
 * Reported:
 *   - a call to `.getFullYear()` or `.getUTCFullYear()`;
 *   - a `Record<K, V>` type, or `new Map<K, V>()`, whose key type `K` names a league, sport or
 *     Season (`Sport`, `SportLeagueCode`, `ProviderLeagueCode`, `SeasonKey`…), unless `V` is a
 *     function type: a table of behaviour is a dispatch, not a fact.
 *
 * Grandfathered files sit on a shrink-only count (`eslint-rules/clock-year-baseline.json`): a
 * file over its count reports every hit, so a listed file cannot add one, and
 * `rules:check:baseline-ratchet` keeps the counts going down. Date arithmetic that is not a
 * season (the last day of a month, a calendar shown on screen) takes
 * `// poolmaster-allow-clock-year: <reason>` on the line before. The sport registry, the scoring
 * families and the display strings are exempt in eslint.config.js: a code-to-words map keyed by
 * sport is a display string, and the frozen registry is retired by its own check.
 */
import { relative, sep } from 'node:path';

import { allowMarkers } from './allow-markers.mjs';

const YEAR_METHODS = new Set(['getFullYear', 'getUTCFullYear']);
/** A key type that names a sport, a league or a Season: `Sport`, `…League`, `…LeagueCode`, `…SeasonKey`. A status or plan enum (`SportEventStatus`, `LeaguePlan`) is not one. */
const KEYED_BY = /^(?:Sport|\w*League|\w*Season|\w*(?:League|Season|Sport)(?:Code|Key|Id))$/;

/** The name a key type refers to: `Sport`, `X.SportLeagueCode`, or a union of such names. */
function keyNames(type) {
  if (!type) return [];
  switch (type.type) {
    case 'TSTypeReference':
      return [type.typeName.type === 'TSQualifiedName' ? type.typeName.right.name : type.typeName.name];
    case 'TSUnionType':
      return type.types.flatMap(keyNames);
    case 'TSTypeOperator':
    case 'TSIndexedAccessType':
      return keyNames(type.typeAnnotation ?? type.objectType);
    default:
      return [];
  }
}

function isKeyedByLeague(params) {
  const [key, value] = params ?? [];
  if (!key || !value || value.type === 'TSFunctionType') return false;
  return keyNames(key).some((name) => typeof name === 'string' && KEYED_BY.test(name));
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'No year worked out from a date, and no table of facts keyed by league, sport or Season, in production source: read the Season or the fact from the model.',
    },
    schema: [{
      type: 'object',
      properties: { baseline: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } } },
      additionalProperties: false,
    }],
    messages: {
      clockYear:
        '{{method}}() works a year out of a date. The current year or season is the league\'s Season (its championshipYear or provider season id), read from the model or the API (rules/domain-model-conventions-rules.md §17). Date arithmetic that is not a season takes "// poolmaster-allow-clock-year: <reason>".',
      leagueTable:
        'A table keyed by {{key}} holds facts about particular leagues or sports in code. Put them on the model (a column on the league, slot definition or Season) and read them (rules/domain-model-conventions-rules.md §17).',
      overBaseline:
        '{{what}} — this file has {{found}} clock-year or league-table hits and eslint-rules/clock-year-baseline.json allows {{allowed}}. Remove the new one: read the fact from the model.',
      missingReason: 'poolmaster-allow-clock-year needs a reason: "// poolmaster-allow-clock-year: <why this is not a season>".',
      unusedAllow: 'This poolmaster-allow-clock-year marker excuses nothing; delete it.',
    },
  },
  create(context) {
    const baseline = context.options[0]?.baseline ?? {};
    const file = relative(context.cwd, context.filename).split(sep).join('/');
    const allowed = baseline[file] ?? 0;
    const allow = allowMarkers(context, 'poolmaster-allow-clock-year');
    const hits = [];

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed || !YEAR_METHODS.has(callee.property.name)) return;
        if (allow.covers(node)) return;
        hits.push({ node, messageId: 'clockYear', data: { method: callee.property.name }, what: `${callee.property.name}()` });
      },
      TSTypeReference(node) {
        if (node.typeName.type !== 'Identifier' || node.typeName.name !== 'Record') return;
        const params = (node.typeArguments ?? node.typeParameters)?.params;
        if (!isKeyedByLeague(params)) return;
        const key = keyNames(params[0]).join(' | ');
        hits.push({ node, messageId: 'leagueTable', data: { key }, what: `Record<${key}, …>` });
      },
      NewExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'Map') return;
        const params = (node.typeArguments ?? node.typeParameters)?.params;
        if (!isKeyedByLeague(params)) return;
        const key = keyNames(params[0]).join(' | ');
        hits.push({ node, messageId: 'leagueTable', data: { key }, what: `Map<${key}, …>` });
      },
      'Program:exit'() {
        allow.reportUnused();
        if (hits.length <= allowed) return;
        for (const { node, messageId, data, what } of hits) {
          if (allowed === 0) context.report({ node, messageId, data });
          else context.report({ node, messageId: 'overBaseline', data: { what, found: String(hits.length), allowed: String(allowed) } });
        }
      },
    };
  },
};
