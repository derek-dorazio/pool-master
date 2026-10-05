# Claude Instructions

@AGENTS.md

`AGENTS.md`, imported above, is the canonical instruction file and is shared with other
coding agents. Do not add policy here; put it in `rules/` and route to it from `AGENTS.md`.

Claude Code also loads `.claude/rules/*.md` on its own: short reminders scoped by `paths:`
frontmatter, injected when a matching file is opened. They summarise and cite `rules/`; they
never introduce a rule of their own.
