/**
 * Banned: deciding behaviour by comparing a league plan to a value (#944).
 *
 * What a plan allows is PLAN_CONFIG, and the one place a plan becomes caps and features is
 * core-api's plan entitlements service (`packages/core-api/src/modules/plans/`). A comparison
 * like `league.plan === LeaguePlan.FREE` anywhere else is a rule a root admin cannot change on
 * the Plans page, and one the next plan has to find by hand. Callers ask the service about a
 * cap or a feature instead (plans/monetization-strategy.md, *One entitlements function*).
 *
 * Reported:
 *   - any comparison (equality or order) with a `LeaguePlan.X` member on either side;
 *   - an equality test between a `plan` value (`plan`, `x.plan`) and a string literal;
 *   - a `switch` on a `plan` value, or with a `case LeaguePlan.X`;
 *   - `LEAGUE_PLANS` or `CAPPED_LEAGUE_PLANS` `.indexOf(...)` or `.includes(...)`: where a plan
 *     sits in the order, or whether it is capped, is the same comparison in another form.
 *     Iterating those arrays (listing every plan) is allowed.
 *
 * Comparing two plan values (`a.plan === b.plan`, "did the plan change") is allowed. The
 * plans folder is exempt in eslint.config.js.
 */
const EQUALITY = new Set(['===', '!==', '==', '!=']);
const ORDER = new Set(['<', '<=', '>', '>=']);

function isPlanMember(node) {
  return node.type === 'MemberExpression'
    && node.object.type === 'Identifier'
    && node.object.name === 'LeaguePlan';
}

function isPlanValue(node) {
  if (node.type === 'Identifier') return node.name === 'plan';
  return node.type === 'MemberExpression'
    && !node.computed
    && node.property.type === 'Identifier'
    && node.property.name === 'plan';
}

const PLAN_ORDER_ARRAYS = new Set(['LEAGUE_PLANS', 'CAPPED_LEAGUE_PLANS']);
const ORDER_LOOKUPS = new Set(['indexOf', 'includes', 'lastIndexOf']);

function isPlanOrderLookup(node) {
  const { callee } = node;
  return callee.type === 'MemberExpression'
    && !callee.computed
    && callee.object.type === 'Identifier'
    && PLAN_ORDER_ARRAYS.has(callee.object.name)
    && callee.property.type === 'Identifier'
    && ORDER_LOOKUPS.has(callee.property.name);
}

function isStringLiteral(node) {
  return node.type === 'Literal' && typeof node.value === 'string';
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'What a league plan allows comes from the plan entitlements service, never from a comparison against a plan.',
    },
    schema: [],
    messages: {
      planBranch:
        'Do not branch on a particular plan here. Ask the plan entitlements service '
        + '(packages/core-api/src/modules/plans/) about the cap or feature instead.',
    },
  },
  create(context) {
    return {
      BinaryExpression(node) {
        const { left, right } = node;
        if (ORDER.has(node.operator) && (isPlanMember(left) || isPlanMember(right))) {
          context.report({ node, messageId: 'planBranch' });
          return;
        }
        if (!EQUALITY.has(node.operator)) return;
        if (isPlanMember(left) || isPlanMember(right)
          || (isPlanValue(left) && isStringLiteral(right))
          || (isPlanValue(right) && isStringLiteral(left))) {
          context.report({ node, messageId: 'planBranch' });
        }
      },
      CallExpression(node) {
        if (isPlanOrderLookup(node)) {
          context.report({ node, messageId: 'planBranch' });
        }
      },
      SwitchStatement(node) {
        if (isPlanValue(node.discriminant)
          || node.cases.some((switchCase) => switchCase.test && isPlanMember(switchCase.test))) {
          context.report({ node, messageId: 'planBranch' });
        }
      },
    };
  },
};
