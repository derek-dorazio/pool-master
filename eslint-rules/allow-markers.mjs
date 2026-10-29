/**
 * The `// <marker>: <reason>` escape hatch shared by the performance rules (`no-query-in-loop`,
 * `no-list-lookup`); inside JSX, the same text as a block comment. A marker on the line before a
 * flagged node, or before the statement holding it, excuses that node. A marker without a colon
 * and a reason is reported, and so is one that excuses nothing: a fix removes the comment that names its ticket.
 *
 * Usage, inside `create(context)`:
 *   const allow = allowMarkers(context, 'poolmaster-allow-…');
 *   if (!allow.covers(node)) context.report(...);
 *   'Program:exit'() { allow.reportUnused(); }
 * The rule declares the `missingReason` and `unusedAllow` messages.
 */
function enclosingStatementLine(node) {
  for (let current = node; current; current = current.parent) {
    if (current.parent && (current.parent.type === 'BlockStatement' || current.parent.type === 'Program')) {
      return current.loc.start.line;
    }
  }
  return node.loc.start.line;
}

export function allowMarkers(context, marker) {
  // The marker ends at a colon or the end of the comment: `<marker>-foo` is another word.
  const pattern = new RegExp(`^${marker}(?![\\w-])(.*)$`, 's');
  /** Marker comments by the line they end on. */
  const markers = new Map();
  const used = new Set();

  // Block comments count too: inside JSX a block comment is the only kind there is.
  for (const comment of context.sourceCode.getAllComments()) {
    const match = pattern.exec(comment.value.trim());
    if (!match) continue;
    const rest = match[1].trim();
    if (!rest.startsWith(':') || rest.slice(1).trim() === '') {
      context.report({ loc: comment.loc, messageId: 'missingReason' });
      used.add(comment);
    }
    markers.set(comment.loc.end.line, comment);
  }

  return {
    covers(node) {
      for (const line of [node.loc.start.line, enclosingStatementLine(node)]) {
        const comment = markers.get(line - 1);
        if (comment) {
          used.add(comment);
          return true;
        }
      }
      return false;
    },
    reportUnused() {
      for (const comment of markers.values()) {
        if (!used.has(comment)) context.report({ loc: comment.loc, messageId: 'unusedAllow' });
      }
    },
  };
}
