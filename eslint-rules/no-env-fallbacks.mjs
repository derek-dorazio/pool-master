/**
 * Replaces scripts/check-no-env-fallbacks.mjs.
 *
 * Banned: an environment read whose miss is absorbed by a hardcoded string, e.g.
 * `process.env.APP_ENV ?? 'development'`. Per service-rules.md §1 and the
 * pool-master-rop.76.1 defect, deployment identity and secrets come from a single
 * bootstrap source that throws (packages/core-api/src/core/config.ts). A fallback
 * means a misconfigured deployment reports something plausible and wrong instead of
 * failing at startup — and "plausible and wrong" is exactly the signal an operator
 * uses to tell a misconfigured box from a healthy one.
 *
 * The scanner this replaces matched one physical line with a regex, and failed open
 * on two shapes that are live in this repo:
 *
 *   1. A chain split across lines. `process.env.APP_ENV\n  ?? process.env.NODE_ENV\n
 *      ?? 'development'` never put a read and a literal on the same line, so every
 *      log line from a misconfigured production box claimed env "development".
 *   2. A lowercase variable name. The regex required [A-Z_][A-Z0-9_]*, so
 *      `process.env.npm_package_version ?? '0.1.0'` was invisible.
 *
 * Walking the AST closes both: the rule finds the LAST operand of a ??/|| chain
 * whose left side reads an env object, however the source is wrapped.
 *
 * Deliberately NOT flagged, matching the scanner's documented allowances:
 *   - `?? ''` — an empty sentinel is "not configured", not a default identity.
 *   - `?? 0`, `?? DEFAULT_X`, `?? null` — tunables (timeouts, pool sizes) and
 *     explicit absence. Promoting a tunable to bootstrap is a separate decision.
 *   - names in `allow` — see the option below.
 */

const DEFAULT_ENV_OBJECTS = ['process.env', 'import.meta.env'];

function unwrap(node) {
  let current = node;
  for (;;) {
    if (
      current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'TSTypeAssertion'
    ) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

/** `process.env` / `import.meta.env` — the object half, not the variable. */
function envObjectPath(node) {
  const target = unwrap(node);
  if (target.type !== 'MemberExpression' || target.computed) return null;
  const { object, property } = target;
  if (property.type !== 'Identifier') return null;
  if (object.type === 'Identifier') return `${object.name}.${property.name}`;
  if (object.type === 'MetaProperty') {
    return `${object.meta.name}.${object.property.name}.${property.name}`;
  }
  return null;
}

/**
 * The variable name in an env read, or null if this is not one.
 * Handles the computed form (`process.env['APP_ENV']`) as well as the dotted one,
 * because they are the same read and the regex only ever saw the dotted one.
 */
function envVarName(node, envObjects) {
  const target = unwrap(node);
  if (target.type !== 'MemberExpression') return null;
  const path = envObjectPath(target.object);
  if (path === null || !envObjects.includes(path)) return null;
  if (!target.computed && target.property.type === 'Identifier') {
    return target.property.name;
  }
  if (
    target.computed &&
    target.property.type === 'Literal' &&
    typeof target.property.value === 'string'
  ) {
    return target.property.value;
  }
  return null;
}

/** A non-empty string literal, or a template with no interpolation. */
function hardcodedString(node) {
  const target = unwrap(node);
  if (target.type === 'Literal' && typeof target.value === 'string') {
    return target.value.length > 0;
  }
  if (target.type === 'TemplateLiteral' && target.expressions.length === 0) {
    return target.quasis.some((q) => q.value.cooked && q.value.cooked.length > 0);
  }
  // `X ? 'a' : 'b'` as the tail of a chain is a fallback with extra steps --
  // it is the obvious way around a rule that only looks for a bare literal.
  if (target.type === 'ConditionalExpression') {
    return hardcodedString(target.consequent) || hardcodedString(target.alternate);
  }
  return false;
}

/**
 * Collect the operands of a flat ??/|| chain, left to right. `a ?? b ?? c` parses
 * as `(a ?? b) ?? c`, so the reads and the literal can sit any distance apart in
 * the source -- which is what defeated the line-based scanner.
 */
function flattenChain(node, operators, out = []) {
  const target = unwrap(node);
  if (target.type === 'LogicalExpression' && operators.includes(target.operator)) {
    flattenChain(target.left, operators, out);
    flattenChain(target.right, operators, out);
  } else {
    out.push(target);
  }
  return out;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Environment reads must fail loud rather than absorb a miss with a hardcoded string.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          envObjects: { type: 'array', items: { type: 'string' } },
          // Variables whose default is a genuine tunable rather than an identity.
          // Each entry is a decision that a wrong value is harmless; keep it short.
          allow: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      envFallback:
        "process.env.{{name}} falls back to a hardcoded string. Route the read through a "
        + 'bootstrap reader in core/config.ts that throws when it is unset — a fallback lets a '
        + 'misconfigured deployment report something plausible and wrong instead of failing at startup.',
    },
  },
  create(context) {
    const options = context.options[0] || {};
    const envObjects = options.envObjects || DEFAULT_ENV_OBJECTS;
    const allow = new Set(options.allow || []);

    return {
      LogicalExpression(node) {
        if (node.operator !== '??' && node.operator !== '||') return;
        // Report once per chain, from its outermost node.
        const parent = unwrap(node.parent || {});
        if (
          parent.type === 'LogicalExpression' &&
          (parent.operator === '??' || parent.operator === '||')
        ) {
          return;
        }

        const operands = flattenChain(node, ['??', '||']);
        const tail = operands[operands.length - 1];
        if (!hardcodedString(tail)) return;

        // Any env read earlier in the chain is the one the fallback is covering.
        for (const operand of operands.slice(0, -1)) {
          const name = envVarName(operand, envObjects);
          if (name !== null && !allow.has(name)) {
            context.report({ node, messageId: 'envFallback', data: { name } });
            return;
          }
        }
      },
    };
  },
};
