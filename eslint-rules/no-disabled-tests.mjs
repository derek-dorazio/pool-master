/**
 * Replaces scripts/check-test-disable-discipline.mjs, and changes its policy.
 *
 * The scanner did not ban skipped tests. It banned UNDOCUMENTED ones: a `.skip`
 * with a `SKIP: #123` comment within two lines above it passed the gate forever.
 * That made a marker a permanent exemption rather than a debt, and nothing ever
 * reconciled a marker against the issue it named — an issue could close with the
 * skip still in the suite.
 *
 * The policy is now unconditional: no skipped, todo, or failing-marked tests, and
 * no escape comment. A test that cannot pass is either fixed or deleted; a test
 * that is kept but not run is a green suite making a claim it does not check.
 *
 * Migration cost was zero — the repo had no skipped tests when this landed, so
 * the rule locks in the current state rather than demanding a cleanup.
 *
 * Also carried over from the scanner: whole skipped FILES (`*.skip.test.ts`) and
 * `skipped/` directories, which are the same evasion at a coarser grain.
 */

const DISABLED_MEMBERS = new Set(['skip', 'todo', 'fails', 'failing', 'concurrent']);
const RUNNERS = new Set(['it', 'test', 'describe', 'suite', 'bench']);
const X_PREFIXED = new Set(['xit', 'xtest', 'xdescribe', 'xspecify']);
const SKIPPED_PATH = /(?:^|\/)(?:skipped\/|[^/]*\.skip\.(?:test|spec)\.tsx?$)/;

/** `it.skip` / `describe.skip`, and the `it.skip.each` / `it.each(...).skip` forms. */
function disabledMemberName(callee) {
  let node = callee;
  // Walk down through `.each`, `.each(table)`, and chained modifiers so that
  // `it.skip.each([...])` and `it.concurrent.skip` both resolve.
  while (node && node.type === 'CallExpression') node = node.callee;
  while (node && node.type === 'MemberExpression') {
    if (node.property.type === 'Identifier' && DISABLED_MEMBERS.has(node.property.name)) {
      // `concurrent` alone is not a skip -- only flag it when the chain also
      // roots at a test runner, which the caller checks.
      if (node.property.name === 'concurrent') return null;
      return node.property.name;
    }
    let next = node.object;
    while (next && next.type === 'CallExpression') next = next.callee;
    node = next;
  }
  return null;
}

/** The base identifier a member chain roots at: `it` in `it.skip.each`. */
function rootIdentifier(callee) {
  let node = callee;
  for (;;) {
    if (node.type === 'CallExpression') node = node.callee;
    else if (node.type === 'MemberExpression') node = node.object;
    else return node.type === 'Identifier' ? node.name : null;
  }
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Tests are run or deleted. A skipped test is a green suite making an unchecked claim.',
    },
    schema: [],
    messages: {
      disabledTest:
        'Disabled test ({{form}}). A test that cannot pass is fixed or deleted — there is no '
        + 'marker that exempts it, because a skip with an issue number stays green forever and '
        + 'nothing reconciles it when that issue closes.',
      skippedFile:
        'Skipped test file or directory ({{name}}). Delete it or bring it back into the suite — '
        + 'a file parked outside the run is a skipped test at a coarser grain.',
    },
  },
  create(context) {
    const filename = context.filename || context.getFilename();

    return {
      Program(node) {
        if (SKIPPED_PATH.test(filename.replace(/\\/g, '/'))) {
          context.report({ node, messageId: 'skippedFile', data: { name: filename } });
        }
      },
      CallExpression(node) {
        const { callee } = node;

        // `xit(...)` / `xdescribe(...)`
        if (callee.type === 'Identifier') {
          if (X_PREFIXED.has(callee.name)) {
            context.report({ node: callee, messageId: 'disabledTest', data: { form: callee.name } });
          } else if (callee.name === 'pending') {
            context.report({ node: callee, messageId: 'disabledTest', data: { form: 'pending()' } });
          }
          return;
        }

        if (callee.type !== 'MemberExpression') return;
        const root = rootIdentifier(callee);
        if (root === null || !RUNNERS.has(root)) return;
        const member = disabledMemberName(callee);
        if (member !== null) {
          context.report({
            node: callee,
            messageId: 'disabledTest',
            data: { form: `${root}.${member}` },
          });
        }
      },
    };
  },
};
