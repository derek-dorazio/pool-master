/**
 * Banned: queuing a background job or a leaderboard rebuild straight from a write. A write that
 * sets off work beyond itself describes its change as a `DomainEvent` and takes its jobs from
 * the one handler map, `DOMAIN_EVENT_HANDLERS` (#1946, #1951). A job queued by the writer is a
 * follow-up no reader of the map can see, which is what the map exists to stop.
 * `architecture-rules.md` §4 *Follow-up work is a domain event handler* says why.
 *
 * A queuing call is recognised by the declared type of its receiver, read through `Pick`,
 * `Omit`, `Partial`, `Readonly`, `Required`, intersections and unions:
 *   - `request`, `enqueue`, `enqueueReturning`, `enqueueRequestReturning` and `enqueueAll` on a
 *     `BackgroundJobQueue`;
 *   - `enqueue`, `enqueueReturning` and `enqueueAll` on a `BackgroundJobRepository`;
 *   - `eventsChanged` and `contestsChanged` on a `LeaderboardRebuilds`.
 * The rule needs type information; without it there is nothing to recognise and it stays quiet.
 *
 * Where a job is built or started is not linted (eslint.config.js lists the files): the job
 * builders and the handlers beside them (`*-job-requests.ts`, `*-job.ts`), and the queue itself
 * (`modules/background-jobs`). Those files hold only payloads, requests and handlers; a job's
 * runner, which writes state, lives in a file of its own that is linted. An entry point that starts work rather than reacting to a change
 * (a provider's webhook, an admin's sync or rebuild route, a sweep on a timer, a read asking for
 * a stale board to be rebuilt) says so where it queues:
 *   // poolmaster-allow-direct-job: <what starts the work>
 * on the line before the call or before the statement holding it. A missing reason is an error,
 * and so is a marker that no longer covers a call.
 */
import { allowMarkers } from './allow-markers.mjs';

const MARKER = 'poolmaster-allow-direct-job';

/** The queuing methods of each receiver type the rule knows. */
const QUEUING_METHODS = new Map([
  ['BackgroundJobQueue', new Set(['request', 'enqueue', 'enqueueReturning', 'enqueueRequestReturning', 'enqueueAll'])],
  ['BackgroundJobRepository', new Set(['enqueue', 'enqueueReturning', 'enqueueAll'])],
  ['LeaderboardRebuilds', new Set(['eventsChanged', 'contestsChanged'])],
]);
const UTILITY_ALIASES = new Set(['Pick', 'Omit', 'Partial', 'Readonly', 'Required']);

function propertyName(member) {
  return !member.computed && member.property.type === 'Identifier' ? member.property.name : null;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Follow-up jobs come from the domain event handler map, not from the writer (architecture-rules.md §4 *Follow-up work is a domain event handler*).',
    },
    schema: [],
    messages: {
      directJob:
        '`{{method}}` on a {{receiver}} queues a follow-up the domain event handler map cannot see. ' +
        'Describe the change as a DomainEvent, collect its jobs with DomainEvents.collect and add a ' +
        'handler beside the job builder (architecture-rules.md §4 *Follow-up work is a domain event ' +
        'handler*). An entry point that starts work rather than reacting to a change says so with ' +
        '`// poolmaster-allow-direct-job: <what starts the work>` on the line before.',
      missingReason: '`poolmaster-allow-direct-job` needs a reason after a colon: what starts the work here.',
      unusedAllow: 'This `poolmaster-allow-direct-job` marker covers no queuing call; remove it.',
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    const checker = services?.program ? services.program.getTypeChecker() : null;
    const allow = allowMarkers(context, MARKER);

    /** The names a node's declared type goes by, through utility aliases, unions and intersections. */
    function typeNames(node) {
      const names = new Set();
      if (!checker || !services.esTreeNodeToTSNodeMap) return names;
      const tsNode = services.esTreeNodeToTSNodeMap.get(node);
      if (!tsNode) return names;
      const seen = new Set();
      const visit = (type) => {
        if (!type || seen.has(type)) return;
        seen.add(type);
        const alias = type.aliasSymbol?.getName();
        if (alias && UTILITY_ALIASES.has(alias)) {
          visit(type.aliasTypeArguments?.[0]);
          return;
        }
        if (alias) names.add(alias);
        const symbol = type.getSymbol();
        if (symbol) names.add(symbol.getName());
        // A class that implements a known interface (`JobLeaderboardRebuilds`) is one too.
        for (const base of type.getBaseTypes?.() ?? []) visit(base);
        const declarations = symbol?.getDeclarations() ?? [];
        for (const declaration of declarations) {
          for (const clause of declaration.heritageClauses ?? []) {
            for (const heritage of clause.types) visit(checker.getTypeAtLocation(heritage));
          }
        }
        if (type.isUnionOrIntersection()) type.types.forEach(visit);
      };
      visit(checker.getTypeAtLocation(tsNode));
      return names;
    }

    return {
      CallExpression(node) {
        const callee = node.callee.type === 'ChainExpression' ? node.callee.expression : node.callee;
        if (callee.type !== 'MemberExpression') return;
        const method = propertyName(callee);
        if (!method) return;
        if (![...QUEUING_METHODS.values()].some((methods) => methods.has(method))) return;
        const names = typeNames(callee.object);
        const receiver = [...QUEUING_METHODS].find(([type, methods]) => names.has(type) && methods.has(method))?.[0];
        if (!receiver || allow.covers(node)) return;
        context.report({ node, messageId: 'directJob', data: { method, receiver } });
      },
      'Program:exit'() {
        allow.reportUnused();
      },
    };
  },
};
