/**
 * Banned: reading `NODE_ENV` in backend source (#184).
 *
 * `NODE_ENV` belongs to Node and third-party libraries. It holds `development` | `test` |
 * `production`, and Terraform sets it to `production` in every deployment. Which environment
 * this is -- qa, staging, prod -- is `POOLMASTER_ENVIRONMENT`, read through `readAppEnv()` in
 * core/config.ts. `service-rules.md` §1 *Which Environment This Is* states the split.
 *
 * The rule exists because the two drifted once already: `session-cookies.ts` tested
 * `NODE_ENV === 'production'` while Terraform put `qa` in it, so session cookies shipped
 * without `Secure` in every deployment (#182).
 *
 * Any member access named `NODE_ENV` is reported, not only `process.env.NODE_ENV`: backend
 * code takes an injected `env: NodeJS.ProcessEnv`, and `env.NODE_ENV` is the same read.
 * Destructuring (`const { NODE_ENV } = process.env`) is the same read too.
 */
const NAME = 'NODE_ENV';

function isNodeEnvKey(node, computed) {
  if (!computed && node.type === 'Identifier') return node.name === NAME;
  return node.type === 'Literal' && node.value === NAME;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Backend code reads POOLMASTER_ENVIRONMENT through readAppEnv(), never NODE_ENV.',
    },
    schema: [],
    messages: {
      nodeEnvRead:
        'Do not read NODE_ENV here: it is the Node ecosystem\'s variable and is "production" in '
        + 'every deployment. Use readAppEnv() from core/config.ts (POOLMASTER_ENVIRONMENT). '
        + 'See rules/service-rules.md §1 *Which Environment This Is*.',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (isNodeEnvKey(node.property, node.computed)) {
          context.report({ node, messageId: 'nodeEnvRead' });
        }
      },
      'ObjectPattern > Property'(node) {
        if (isNodeEnvKey(node.key, node.computed)) {
          context.report({ node, messageId: 'nodeEnvRead' });
        }
      },
    };
  },
};
