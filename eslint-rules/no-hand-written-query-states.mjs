/**
 * #1588. A query's loading, error and empty states come from the shared `QueryState`,
 * `LoadingState`, `ErrorState` and `EmptyState` (or a page template that draws them), so the app
 * has one spinner, one red error line with Retry and one italic empty line.
 *
 * Reports three things in feature code:
 * - "Loading ..." words anywhere but a state component's props (or `useLeagueContextGuard`'s
 *   options), such as `{query.isLoading ? 'Loading invitation...' : null}`;
 * - "could not load" / "couldn't load" / "unable to load" words anywhere but a state component's
 *   props or a logger call, such as an `<Alert>` or a `<p>` built for a failed read;
 * - an `ErrorState`, or a page template given a `state` (which may be "error"), with no
 *   `onRetry`, since every failed read offers Retry.
 *
 * Not a page state, so never reported: a button's label ("Saving...", "Loading more..."), anything
 * inside a `Button` or `LinkButton`, and an `aria-label`. Out of scope: copy kept in `.ts` modules
 * (this rule reads `.tsx` feature code) and a mutation's own "could not load" refusal, which is a
 * save failing rather than a read.
 */
const STATE_COMPONENTS = new Set([
  'AsyncPage',
  'DataGridPage',
  'EmptyState',
  'EntityDetailPage',
  'ErrorState',
  'LoadingState',
  'ManagementListPage',
  'QueryState',
]);
// Calls whose arguments carry state words to a shared state, or only to the log.
const ALLOWED_CALLS = new Set(['useLeagueContextGuard']);
const LOGGER_OBJECTS = new Set(['logger', 'log']);
// Controls whose labels may say "Loading more..." without being a page state.
const BUTTON_COMPONENTS = new Set(['Button', 'LinkButton', 'button']);
const LABEL_ATTRIBUTES = new Set(['aria-label']);
// Page templates that draw an error state when their `state` prop says so.
const STATE_TEMPLATES = new Set(['AsyncPage', 'DataGridPage', 'EntityDetailPage', 'ManagementListPage']);

const LOADING_WORDS = /^\s*Loading\b.*(?:\.\.\.|…)\s*$/s;
const LOADING_JSX_TEXT = /^\s*Loading\s/;
const FAILED_LOAD_WORDS = /\b(?:couldn['’]t|could not|unable to) load\b/i;

function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier') return callee.object.name;
  return null;
}

function elementName(element) {
  const name = element.openingElement?.name ?? element.name;
  return name?.type === 'JSXIdentifier' ? name.name : null;
}

/** Whether the words are a button's label or an accessible label, not a page state. */
function isControlLabel(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'JSXAttribute' && LABEL_ATTRIBUTES.has(current.name.name)) return true;
    if (current.type === 'JSXElement' && BUTTON_COMPONENTS.has(elementName(current))) return true;
    if (current.type === 'Program') return false;
  }
  return false;
}

/**
 * JSX text is cut at every {expression}, so "Loading {year} events..." arrives as "Loading ".
 * It reads as a loading line only when the element's text ends in an ellipsis.
 */
function endsInEllipsis(node) {
  const texts = (node.parent?.children ?? []).filter((child) => child.type === 'JSXText' && child.value.trim());
  const last = texts[texts.length - 1];
  return Boolean(last) && /(?:\.\.\.|…)\s*$/.test(last.value);
}

/** Whether the words sit in a state component's prop, an allowed call or a log line. */
function isInSharedState(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'JSXAttribute') {
      const element = current.parent;
      return element.name.type === 'JSXIdentifier' && STATE_COMPONENTS.has(element.name.name);
    }
    if (current.type === 'CallExpression' || current.type === 'NewExpression') {
      const name = calleeName(current.callee);
      if (name && ALLOWED_CALLS.has(name)) return true;
      if (current.callee.type === 'MemberExpression' && name && LOGGER_OBJECTS.has(name)) return true;
      // extractErrorMessage(error, { fallback: "..." }) and cn(...) pass words on; keep climbing.
      continue;
    }
    if (
      current.type === 'JSXElement' ||
      current.type === 'JSXFragment' ||
      current.type === 'ReturnStatement' ||
      current.type === 'VariableDeclarator' ||
      current.type === 'Program'
    ) {
      return false;
    }
  }
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: "A query's loading, error and empty states use the shared QueryState/LoadingState/ErrorState/EmptyState.",
    },
    schema: [],
    messages: {
      handWrittenLoading:
        'Hand-written loading words "{{text}}" — draw it with LoadingState or QueryState (pass the words as its body/loading).',
      handWrittenError:
        'Hand-written load failure "{{text}}" — draw it with ErrorState (with onRetry) or QueryState.',
      errorWithoutRetry: '{{component}} without onRetry — every failed read offers Retry; pass the query\'s refetch.',
    },
  },
  create(context) {
    function check(node, text, isJsxText = false) {
      if (isControlLabel(node)) return;
      const loading = LOADING_WORDS.test(text) || (isJsxText && LOADING_JSX_TEXT.test(text) && endsInEllipsis(node));
      if (loading && !isInSharedState(node)) {
        context.report({ node, messageId: 'handWrittenLoading', data: { text: text.trim() } });
      } else if (FAILED_LOAD_WORDS.test(text) && !isInSharedState(node)) {
        context.report({ node, messageId: 'handWrittenError', data: { text: text.trim() } });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
      JSXText(node) {
        check(node, node.value, true);
      },
      JSXOpeningElement(element) {
        if (element.name.type !== 'JSXIdentifier') return;
        const component = element.name.name;
        const named = (name) => element.attributes.some(
          (attribute) => attribute.type === 'JSXAttribute' && attribute.name.name === name,
        );
        const needsRetry = component === 'ErrorState' || (STATE_TEMPLATES.has(component) && named('state'));
        if (!needsRetry) return;
        // `onRetry={null}` is an explicit "this failure is permanent" and counts as a choice.
        const hasRetry = named('onRetry') || element.attributes.some((attribute) => attribute.type === 'JSXSpreadAttribute');
        if (!hasRetry) context.report({ node: element, messageId: 'errorWithoutRetry', data: { component } });
      },
    };
  },
};
