---
paths:
  - "rules/**"
  - "docs/**"
  - "AGENTS.md"
  - "CLAUDE.md"
  - "README.md"
  - ".claude/**/*.md"
  - "packages/**/README.md"
  - "clients/**/README.md"
---

# Rules and docs — keep one canonical home

You are editing guidance that other sessions will load. Each line cites its one canonical
statement, which wins if this summary ever disagrees.

- **One canonical home per concept.** If the thing you are writing already exists, link to
  it as `rules/<file>.md §N *Section Name*` instead of restating it. A second copy drifts,
  and the drifted copy is the one someone reads. `rules/workflow-rules.md` §0 *Document
  Lifecycle*.
- **Write what a manifest cannot say.** A prohibition, an invariant, a deliberate absence or
  a trap carries information; a list of scripts, packages, directories or current status
  restates `package.json` or the filesystem and rots. `rules/workflow-rules.md` §2 *Rule and
  Documentation Maintenance*.
- **Read both sections before merging two that "both mention X"** — overlapping subject is
  not shared ownership. Same section.
- **Route the knowledge to its reader**: a code comment for constraints on existing code, a
  rule for code not yet written, product truth for what is true of the product, an ADR for a
  rejected alternative. `rules/workflow-rules.md` §0 governing rule 7.
- **`.claude/rules/` files stay short and cite; they never introduce policy.** Change the
  canonical rule, then this summary if it no longer matches.
