/**
 * Banned: a screen that loads a list query and then, in the browser, keeps one row, counts the
 * rows, or filters most of them away (#1241).
 *
 * The audit (#1158) found several screens doing this (#1161, #1196, #1198, #1201): the list
 * grows with every league's history while the answer stays one row or one number. The fix is
 * the single-item endpoint, a filter parameter, or a count from the server
 * (`react-ui-rules.md` §4 *TanStack Query Rules*).
 *
 * Query data is what a `use…Query` hook returns under `data`, and the array in a list envelope
 * one property below it (list responses are entity-named envelopes, `{ leagues: [...] }`):
 *   const leaguesQuery = useLeaguesQuery();  leaguesQuery.data?.leagues
 *   const { data } = useLeaguesQuery();      data?.leagues
 *   const { data: leagues = [] } = useSportLeaguesQuery();
 *   const leagues = leaguesQuery.data?.leagues ?? [];   (an alias carries it on)
 * With type information, only an array is a list, and only the one property of an envelope is:
 * an array inside a detail response (a contest's events) arrived with the screen's own read.
 *
 * Flagged on query data:
 *   - `.find(...)` / `.findIndex(...)` / `.findLast(...)`: one row from a list;
 *   - `.filter(...).length`, and `.length` shown on screen (in JSX, a template literal, or a
 *     `count` / `total` property): a count;
 *   - `.filter(...)` whose test compares an id, status, year, team, squad or user field: a
 *     server filter done in the browser.
 *
 * Escape hatch, for a list that is on screen anyway (a hover detail, a picker's selected row):
 *   // poolmaster-allow-list-lookup: <reason>
 * on the line before. A missing reason is an error, and so is a marker that covers nothing.
 */
import { allowMarkers } from './allow-markers.mjs';

const MARKER = 'poolmaster-allow-list-lookup';
const QUERY_HOOK = /^use[A-Za-z0-9]*Query$/;
const LOOKUP_METHODS = new Set(['find', 'findIndex', 'findLast', 'findLastIndex']);
const FILTER_FIELD = /^(id|status|year|team|squad|user)$|(Id|Status|Year|Team|Squad|User)$/;
const COUNT_KEY = /count|total/i;

/** Strips wrappers that keep the same value: `?.`, `!`, casts, `x ?? []`, `x || []`. */
function unwrap(node) {
  let current = node;
  for (;;) {
    if (current.type === 'ChainExpression' || current.type === 'TSNonNullExpression'
      || current.type === 'TSAsExpression' || current.type === 'TSSatisfiesExpression') {
      current = current.expression;
    } else if (current.type === 'LogicalExpression' && (current.operator === '??' || current.operator === '||')) {
      current = current.left;
    } else {
      return current;
    }
  }
}

function propertyName(member) {
  return !member.computed && member.property.type === 'Identifier' ? member.property.name : null;
}

function isQueryHookCall(node) {
  const call = unwrap(node);
  return call.type === 'CallExpression' && call.callee.type === 'Identifier' && QUERY_HOOK.test(call.callee.name);
}

/** The parent past the same wrappers `unwrap` strips, going up. */
function valueParent(node) {
  let current = node;
  while (current.parent && (current.parent.type === 'ChainExpression' || current.parent.type === 'TSNonNullExpression'
    || current.parent.type === 'TSAsExpression' || current.parent.type === 'TSSatisfiesExpression')) {
    current = current.parent;
  }
  return { node: current, parent: current.parent };
}

/** Whether a filter callback's test compares an id / status / year / team / squad / user field. */
function filtersByKnownField(callback) {
  if (!callback || (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression')) return false;
  let found = false;
  const visit = (node) => {
    if (found || !node || typeof node.type !== 'string') return;
    if (node.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(node.operator)) {
      for (const side of [node.left, node.right]) {
        const value = unwrap(side);
        if (value.type === 'MemberExpression' && FILTER_FIELD.test(propertyName(value) ?? '')) found = true;
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'parent') continue;
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(callback.body);
  return found;
}

function isDisplayedCount(lengthNode) {
  const { node: value, parent } = valueParent(lengthNode);
  if (!parent) return false;
  if (parent.type === 'JSXExpressionContainer' || parent.type === 'TemplateLiteral') return true;
  if (parent.type === 'Property' && parent.value === value) {
    const key = parent.key.type === 'Identifier' ? parent.key.name : String(parent.key.value);
    return COUNT_KEY.test(key);
  }
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'No one-row lookup, count or id/status filter on a list query in the browser (react-ui-rules.md §4).',
    },
    schema: [],
    messages: {
      lookupInList:
        'One row looked up in a list query. Read it from the single-item endpoint instead (rules/react-ui-rules.md §4 *TanStack Query Rules*). For a list already on screen: `// ' + MARKER + ': <reason>` on the line before.',
      countInBrowser:
        'Rows of a list query counted in the browser. Return the count from the server (rules/react-ui-rules.md §4 *TanStack Query Rules*). For a list already on screen: `// ' + MARKER + ': <reason>` on the line before.',
      filterInBrowser:
        'A list query filtered by id, status, year, team or user in the browser. Pass the filter to the endpoint, adding the parameter if it is missing (rules/react-ui-rules.md §4 *TanStack Query Rules*). For a list already on screen: `// ' + MARKER + ': <reason>` on the line before.',
      missingReason: '`' + MARKER + '` needs a reason after the colon: why the whole list is needed here, or the ticket that fixes it.',
      unusedAllow: '`' + MARKER + '` covers no lookup on a list query. Remove it.',
    },
  },
  create(context) {
    const { sourceCode } = context;
    const services = sourceCode.parserServices;
    const checker = services?.program ? services.program.getTypeChecker() : null;
    const allow = allowMarkers(context, MARKER);
    /** Variables holding a whole query result (`leaguesQuery`). */
    const resultVariables = new Set();
    /** Variables holding query data, whatever its shape (`const { data } = useLeaguesQuery()`). */
    const dataVariables = new Set();
    /** Variables holding a list from a query, checked when they were declared. */
    const listVariables = new Set();

    function variableOf(identifier) {
      let scope = sourceCode.getScope(identifier);
      while (scope) {
        const variable = scope.set.get(identifier.name);
        if (variable) return variable;
        scope = scope.upper;
      }
      return null;
    }

    /** `x.data` on a query result, or a variable holding it. */
    function isQueryDataRoot(node) {
      const value = unwrap(node);
      if (value.type === 'Identifier') return dataVariables.has(variableOf(value));
      if (value.type === 'MemberExpression' && propertyName(value) === 'data') {
        const owner = unwrap(value.object);
        if (owner.type === 'Identifier') return resultVariables.has(variableOf(owner));
        return isQueryHookCall(owner);
      }
      return false;
    }

    function typeOf(node) {
      if (!checker || !services.esTreeNodeToTSNodeMap) return null;
      const tsNode = services.esTreeNodeToTSNodeMap.get(node);
      return tsNode ? checker.getNonNullableType(checker.getTypeAtLocation(tsNode)) : null;
    }

    /** Without type information (the syntactic rule tests) the shape alone decides. */
    function isArrayTyped(node) {
      const type = typeOf(node);
      if (!type) return true;
      const parts = type.isUnion() ? type.types : [type];
      return parts.some((part) => checker.isArrayType(part) || checker.isTupleType(part));
    }

    /** An object with one property: a list envelope (`{ leagues: League[] }`), not a detail response. */
    function isEnvelope(node) {
      const type = typeOf(node);
      return !type || type.getProperties().length === 1;
    }

    /**
     * A list: the query data itself as an array, the one array in a list envelope, or a variable
     * holding either. An array inside a detail response (a contest's events, a board's entries)
     * came with the screen's own read and is not a list query.
     */
    function isListData(node) {
      const value = unwrap(node);
      if (value.type === 'Identifier' && listVariables.has(variableOf(value))) return true;
      if (isQueryDataRoot(value)) return isArrayTyped(value);
      return value.type === 'MemberExpression' && propertyName(value) !== null
        && isQueryDataRoot(value.object) && isEnvelope(unwrap(value.object)) && isArrayTyped(value);
    }

    function report(node, messageId) {
      if (!allow.covers(node)) context.report({ node, messageId });
    }

    return {
      VariableDeclarator(node) {
        if (!node.init) return;
        if (node.id.type === 'Identifier') {
          const variable = variableOf(node.id);
          if (isQueryHookCall(node.init)) resultVariables.add(variable);
          else if (isQueryDataRoot(node.init)) dataVariables.add(variable);
          if (isListData(node.init)) listVariables.add(variable);
          return;
        }
        if (node.id.type === 'ObjectPattern' && isQueryHookCall(node.init)) {
          for (const property of node.id.properties) {
            if (property.type !== 'Property' || property.key.type !== 'Identifier' || property.key.name !== 'data') continue;
            const target = property.value.type === 'AssignmentPattern' ? property.value.left : property.value;
            if (target.type !== 'Identifier') continue;
            dataVariables.add(variableOf(target));
            if (isArrayTyped(target)) listVariables.add(variableOf(target));
          }
        }
      },
      CallExpression(node) {
        const { callee } = node;
        if (callee.type !== 'MemberExpression') return;
        const method = propertyName(callee);
        if (LOOKUP_METHODS.has(method) && isListData(callee.object)) {
          report(node, 'lookupInList');
          return;
        }
        if (method === 'filter' && isListData(callee.object)) {
          const { parent } = valueParent(node);
          const counted = parent?.type === 'MemberExpression' && parent.object === valueParent(node).node && propertyName(parent) === 'length';
          if (counted) report(parent, 'countInBrowser');
          else if (filtersByKnownField(node.arguments[0])) report(node, 'filterInBrowser');
        }
      },
      MemberExpression(node) {
        if (propertyName(node) !== 'length' || !isListData(node.object)) return;
        if (isDisplayedCount(node)) report(node, 'countInBrowser');
      },
      'Program:exit'() {
        allow.reportUnused();
      },
    };
  },
};
