/**
 * Banned: a database call per iteration in the backend — a repository or Prisma call inside a
 * loop body, inside a `.map` / `.forEach` / `.flatMap` / `.reduce` callback, or (the same
 * thing) in `Promise.all(rows.map(...))`.
 *
 * Most findings of the performance audit (#1158) were this shape: one query per entry, squad,
 * member or contest, where one `IN` query and a map would do. Running them at once does not
 * make them one query; each takes a pooled connection. `review-triggers.md` §5 *Reviewing for
 * performance cost* says why and what the fix is; this rule makes the shape a red gate (#1240).
 *
 * A database call is recognised by name:
 *   - any method on an object named `…Repository` / `…Repo` / `…repo` (`this.contestRepo.find`,
 *     `input.squadRepo.list`, `this.repository.save`), or whose declared type is named so;
 *   - a Prisma model delegate method on `prisma` / `this.prisma` / `tx`
 *     (`tx.contest.update(...)`), or a raw `$queryRaw` / `$executeRaw` on one of them; with type
 *     information, a delegate method on any object typed as a Prisma `…Delegate`, and raw SQL on
 *     any receiver typed as a Prisma client or transaction. Types are read through `Pick`,
 *     `Omit`, `Partial`, `Readonly`, `Required`, intersections and unions.
 *
 * Only the loop's repeated parts count: the body, and a `for` / `while` test or update. The
 * iterable of `for…of` and a `for` initialiser run once. A callback passed to any other call
 * (a `$transaction(async (tx) => ...)` inside a loop) is treated as running where it is written.
 * A named function is a boundary: the loop that calls it is the caller's business. The right side
 * of `x ??= …` / `x ||= …` is a memo that reads once when `x` is a variable declared outside the
 * loop, and is not flagged; a variable declared inside it, or a property, is flagged.
 *
 * Escape hatch, for a loop with a small fixed bound or a finding a ticket will fix:
 *   // poolmaster-allow-query-in-loop: <reason>
 * on the line before the call or before the statement holding it. A missing reason is an
 * error, and so is a marker that no longer covers a call — a fix removes its own comment.
 */
import { allowMarkers } from './allow-markers.mjs';

const MARKER = 'poolmaster-allow-query-in-loop';

const REPOSITORY_NAME = /(repository|repo)$/i;
const PRISMA_CLIENT_NAMES = new Set(['prisma', 'tx']);
const PRISMA_DELEGATE_METHODS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);
const PRISMA_RAW_METHODS = new Set(['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe']);
const PRISMA_DELEGATE_TYPE = /Delegate$/;
const PRISMA_CLIENT_TYPES = new Set(['PrismaClient', 'TransactionClient', 'DefaultPrismaClient']);
const UTILITY_ALIASES = new Set(['Pick', 'Omit', 'Partial', 'Readonly', 'Required']);
const MEMO_OPERATORS = new Set(['??=', '||=']);
const ITERATING_METHODS = new Set(['map', 'forEach', 'flatMap', 'reduce']);
const LOOP_TYPES = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);
const FUNCTION_TYPES = new Set(['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration']);

/** The last name in `a.b.c` or `this.c`: the name a reader sees for the receiver. */
function terminalName(node) {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    return node.property.name;
  }
  if (node.type === 'TSNonNullExpression') return terminalName(node.expression);
  return null;
}

function propertyName(member) {
  return !member.computed && member.property.type === 'Identifier' ? member.property.name : null;
}

function makeIsQueryCallee(context) {
  const services = context.sourceCode.parserServices;
  const checker = services?.program ? services.program.getTypeChecker() : null;

  /**
   * The names a receiver's declared type goes by, when type information is available. Services
   * declare their dependencies as `Pick<ContestRepository, 'findById'>` or as an intersection of
   * such slots, so utility aliases are unwrapped to the type they wrap and every member of an
   * intersection or union is named.
   */
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
      if (type.isUnionOrIntersection()) type.types.forEach(visit);
    };
    visit(checker.getTypeAtLocation(tsNode));
    return names;
  }

  /** `callee` is a call's callee or a tagged template's tag (`prisma.$queryRaw\`...\``). */
  return function isQueryCallee(callee) {
    if (callee.type !== 'MemberExpression') return false;
    const method = propertyName(callee);
    if (!method) return false;
    const receiver = callee.object;

    const receiverName = terminalName(receiver);
    if (receiverName && PRISMA_CLIENT_NAMES.has(receiverName)) return PRISMA_RAW_METHODS.has(method);
    if (receiver.type === 'MemberExpression') {
      const clientName = terminalName(receiver.object);
      if (clientName && PRISMA_CLIENT_NAMES.has(clientName) && PRISMA_DELEGATE_METHODS.has(method)) return true;
    }
    if (receiverName && REPOSITORY_NAME.test(receiverName)) return true;
    const receiverTypes = [...typeNames(receiver)];
    // A Prisma client or transaction under another name (`db.$queryRaw`).
    if (receiverTypes.some((name) => PRISMA_CLIENT_TYPES.has(name))) return PRISMA_RAW_METHODS.has(method);
    // A Prisma model delegate reached under another name (`db.contest`, `this.store.entries`).
    if (receiverTypes.some((name) => PRISMA_DELEGATE_TYPE.test(name))) return PRISMA_DELEGATE_METHODS.has(method);
    return receiverTypes.some((name) => REPOSITORY_NAME.test(name));
  };
}

function isIteratingCallback(fn) {
  const call = fn.parent;
  if (!call || call.type !== 'CallExpression' || call.arguments[0] !== fn) return false;
  const { callee } = call;
  return callee.type === 'MemberExpression' && ITERATING_METHODS.has(propertyName(callee));
}

/** True when `child` is a part of `loop` that runs once per iteration. */
function isRepeatedPart(loop, child) {
  switch (loop.type) {
    case 'ForStatement':
      return child === loop.body || child === loop.test || child === loop.update;
    case 'ForInStatement':
    case 'ForOfStatement':
      return child === loop.body;
    default:
      return child === loop.body || child === loop.test;
  }
}

/** The loop or iterating callback that repeats `node`, or null. */
/** The variable a plain identifier names, from the scope it is used in outward. */
function variableOf(sourceCode, identifier) {
  for (let scope = sourceCode.getScope(identifier); scope; scope = scope.upper) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
  }
  return null;
}

/** True when `inner` lies inside `outer`'s source range. */
function within(inner, outer) {
  return inner.range[0] >= outer.range[0] && inner.range[1] <= outer.range[1];
}

/**
 * Whether `memo` (an `x ??= …` / `x ||= …`) reads once across `repeater`: only when `x` is a
 * plain variable declared outside it. A variable declared inside the loop starts empty on every
 * pass, and a property (`row.contest ??= …`) is a different object each time.
 */
function memoizesAcross(sourceCode, memo, repeater) {
  if (memo.left.type !== 'Identifier') return false;
  const variable = variableOf(sourceCode, memo.left);
  return variable !== null && variable.defs.length > 0 && variable.defs.every((def) => !within(def.name, repeater));
}

/** The loop or iterating callback that repeats `node`, or null. */
function repeatingAncestor(sourceCode, node) {
  let child = node;
  let memo = null;
  for (let current = node.parent; current; child = current, current = current.parent) {
    if (current.type === 'AssignmentExpression' && MEMO_OPERATORS.has(current.operator) && child === current.right) memo ??= current;
    let repeater = null;
    if (LOOP_TYPES.has(current.type) && isRepeatedPart(current, child)) repeater = current;
    else if (FUNCTION_TYPES.has(current.type)) {
      if (isIteratingCallback(current)) repeater = current;
      else {
        // A callback handed to some other call runs where it is written; anything else
        // (a declaration, a function stored in a variable or property) is a boundary.
        const passedAsArgument = current.parent?.type === 'CallExpression' && current.parent.arguments.includes(current);
        if (!passedAsArgument) return null;
      }
    }
    if (repeater) {
      // `games ??= await repo.find(...)` with `games` declared outside the loop reads once.
      return memo && memoizesAcross(sourceCode, memo, repeater) ? null : repeater;
    }
  }
  return null;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'No repository or Prisma call per loop iteration in the backend; batch it (review-triggers.md §5).',
    },
    schema: [],
    messages: {
      queryInLoop:
        'Database call inside a loop: one query per row. Load the rows with one `IN` query and a map, write with `createMany` / `updateMany`, or pass the loaded row down (rules/review-triggers.md §5 *Reviewing for performance cost*). For a small fixed bound or a ticketed finding: `// ' +
        MARKER +
        ': <reason>` on the line before.',
      missingReason: '`' + MARKER + '` needs a reason after the colon: why this loop is bounded, or the ticket that fixes it.',
      unusedAllow: '`' + MARKER + '` covers no database call in a loop. Remove it.',
    },
  },
  create(context) {
    const isQueryCallee = makeIsQueryCallee(context);
    const allow = allowMarkers(context, MARKER);

    function check(node, callee) {
      // The ancestor walk is cheap; the type lookup in isQueryCallee is not, so it goes second.
      if (!repeatingAncestor(context.sourceCode, node) || !isQueryCallee(callee)) return;
      if (!allow.covers(node)) context.report({ node, messageId: 'queryInLoop' });
    }

    return {
      CallExpression(node) {
        check(node, node.callee);
      },
      TaggedTemplateExpression(node) {
        check(node, node.tag);
      },
      'Program:exit'() {
        allow.reportUnused();
      },
    };
  },
};
