/**
 * Banned: a `sendError(...)` call whose promise is thrown away — `void sendError(...)`, or the
 * call as a bare statement — in the backend.
 *
 * `sendError` returns `reply.send(...)`, and a Fastify reply finishes later than that call
 * returns (the etag `onSend` hook runs first). An async `preHandler` that sends without awaiting
 * resolves while `reply.sent` is still false, so Fastify runs the handler as well: the caller
 * gets the 403 and the write lands anyway. That is how `requireCommissionerForContest` behaved
 * until #193. `service-rules.md` §3 *Route Authorization* makes every gate await its rejection;
 * this rule makes that permanent (#458).
 *
 * `@typescript-eslint/no-floating-promises` does not cover it: `void` is how that rule is told a
 * promise is deliberately ignored, and it is exactly the shape of the bug.
 *
 * Allowed: `await sendError(...)`, `return sendError(...)`, an arrow returning it, or any use of
 * the value. Handlers are covered as well as hooks — returning the reply is the convention there,
 * and there is no case in which discarding it is the intent.
 */
const NAME = 'sendError';

function isSendErrorCall(node) {
  if (node.type !== 'CallExpression') return false;
  const { callee } = node;
  if (callee.type === 'Identifier') return callee.name === NAME;
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === NAME
  );
}

/** Climbs past wrappers that keep the same value: casts, `!`, optional chains, parentheses. */
function valueParent(node) {
  let current = node;
  for (;;) {
    const { parent } = current;
    if (
      parent &&
      (parent.type === 'ChainExpression' ||
        parent.type === 'TSAsExpression' ||
        parent.type === 'TSSatisfiesExpression' ||
        parent.type === 'TSNonNullExpression' ||
        parent.type === 'TSTypeAssertion')
    ) {
      current = parent;
    } else {
      return { node: current, parent };
    }
  }
}

function isDiscarded(node) {
  const { node: value, parent } = valueParent(node);
  if (!parent) return false;
  if (parent.type === 'ExpressionStatement') return true;
  if (parent.type === 'UnaryExpression' && parent.operator === 'void') return true;
  // `a, sendError(...), b` — every operand but the last is discarded.
  if (parent.type === 'SequenceExpression') {
    return parent.expressions[parent.expressions.length - 1] !== value || isDiscarded(parent);
  }
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Await or return sendError(...); a discarded reply lets Fastify run the handler behind the refusal.',
    },
    schema: [],
    messages: {
      unawaitedSendError:
        'sendError(...) is not awaited or returned. In a hook, Fastify then runs the handler behind the refusal (#193): write `await sendError(...)` or `return sendError(...)`.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (isSendErrorCall(node) && isDiscarded(node)) {
          context.report({ node, messageId: 'unawaitedSendError' });
        }
      },
    };
  },
};
