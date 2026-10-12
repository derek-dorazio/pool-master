/**
 * Banned: deciding behaviour by comparing a sport to a value (#602).
 *
 * What differs between sports lives in one of two places: the sport registry
 * (`packages/shared/domain/sports/`, data such as vocabulary and allowed selection types) or
 * the sport's scoring family (behaviour such as storing and scoring results). A comparison
 * like `event.sport === Sport.GOLF` anywhere else is a guard the next sport has to find by
 * hand; before #602 there were fifteen of them. `rules/architecture-rules.md` §4
 * *Sport extension* states the rule.
 *
 * Reported:
 *   - an equality test with a `Sport.X` member on either side;
 *   - an equality test between a `sport` value (`sport`, `x.sport`) and a string literal;
 *   - a `switch` on a `sport` value, or with a `case Sport.X`.
 *
 * Comparing two sport values (`a.sport === b.sport`) is a lookup, not a branch on a
 * particular sport, and is allowed. The registry and scoring-family folders are exempt in
 * eslint.config.js: they are where the difference is meant to live.
 */
const EQUALITY = new Set(['===', '!==', '==', '!=']);

function isSportMember(node) {
  return node.type === 'MemberExpression'
    && node.object.type === 'Identifier'
    && node.object.name === 'Sport';
}

function isSportValue(node) {
  if (node.type === 'Identifier') return node.name === 'sport';
  return node.type === 'MemberExpression'
    && !node.computed
    && node.property.type === 'Identifier'
    && node.property.name === 'sport';
}

function isStringLiteral(node) {
  return node.type === 'Literal' && typeof node.value === 'string';
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Sport-specific behaviour lives in the sport registry or a scoring family, never in a comparison against a sport.',
    },
    schema: [],
    messages: {
      sportBranch:
        'Do not branch on a particular sport here. Put the difference in the sport definition '
        + '(packages/shared/domain/sports/) or the sport\'s scoring family. '
        + 'See rules/architecture-rules.md §4 *Sport extension*.',
    },
  },
  create(context) {
    return {
      BinaryExpression(node) {
        if (!EQUALITY.has(node.operator)) return;
        const { left, right } = node;
        if (isSportMember(left) || isSportMember(right)
          || (isSportValue(left) && isStringLiteral(right))
          || (isSportValue(right) && isStringLiteral(left))) {
          context.report({ node, messageId: 'sportBranch' });
        }
      },
      SwitchStatement(node) {
        if (isSportValue(node.discriminant)
          || node.cases.some((switchCase) => switchCase.test && isSportMember(switchCase.test))) {
          context.report({ node, messageId: 'sportBranch' });
        }
      },
    };
  },
};
