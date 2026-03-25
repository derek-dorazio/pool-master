# PoolMaster — Workflow Rules

## Action Plan Tracking

Every plan document in `plans/` has an **Action Plan** section at the bottom with a task table. These tables are the project's issue tracker — they define all work to be done and track implementation progress.

### Task Table Format

```markdown
| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 01-001 | 1 | Task description | Done | Completed notes |
| 01-002 | 1 | Task description | In Progress | What's done, what remains |
| 01-003 | 1 | Task description | Not Started | |
```

### Status Values

| Status | Meaning |
|---|---|
| **Not Started** | Work has not begun |
| **In Progress** | Work has started but is not complete |
| **Done** | Fully implemented and working |
| **Removed** | Out of scope — strikethrough the task description and explain why |

### Rules for Implementation

**When starting work on a task:**
1. Find the task in the relevant plan file's Action Plan table
2. Update its status from `Not Started` to `In Progress`
3. Add a note describing what you're working on

**When completing a task:**
1. Update its status from `In Progress` to `Done`
2. Add a note with what was built (file paths, key decisions)

**When completing work that spans multiple tasks:**
1. Update ALL affected tasks across ALL relevant plan files
2. A single implementation may complete tasks in multiple plans (e.g. building the scoring engine touches both 01-architecture and 03-scoring-rules)

**When a task is no longer relevant:**
1. Set status to `Removed`
2. Strikethrough the task description with `~~`
3. Add a note explaining why (e.g. "Out of scope — no DFS in v1")

### Finding Tasks

The plan files and their task ID prefixes:

| Prefix | Plan File | Area |
|---|---|---|
| 01-xxx | `plans/01-poolmaster-architecture.md` | Core architecture, foundation, infrastructure |
| 02-xxx | `plans/02-poolmaster-draft-config.md` | Draft/selection mechanics |
| 03-xxx | `plans/03-poolmaster-scoring-rules.md` | Scoring engines and templates |
| 04-xxx | `plans/04-poolmaster-history.md` | Contest and league history |
| 05-xxx | `plans/05-poolmaster-sports-data-integration.md` | Sports data providers |
| 06-xxx | `plans/06-poolmaster-participant-data.md` | Participant management |
| 07-xxx | `plans/07-poolmaster-billing-subscription.md` | Billing and subscriptions |
| 08-xxx | `plans/08-poolmaster-commissioner-tooling.md` | Commissioner tools |
| 09-xxx | `plans/09-poolmaster-notifications-alerts.md` | Notifications |
| 10-xxx | `plans/10-poolmaster-social-communication.md` | Social features |
| 11-xxx | `plans/11-poolmaster-admin-dashboard.md` | Admin dashboard |
| 12-xxx | `plans/12-poolmaster-mobile-client.md` | Mobile clients |
| 13-xxx | `plans/13-poolmaster-search-discovery.md` | Search and discovery |
| 14-xxx | `plans/14-poolmaster-localisation-i18n.md` | Localisation |
| 15-xxx | `plans/15-poolmaster-responsible-gaming.md` | Compliance and legal |

### Important

- **Always check the action plans before and after implementation.** This is how we track progress.
- **Do not create separate issue trackers.** The plan files ARE the issue tracker.
- **Cross-reference tasks when they depend on each other.** Use the task ID in the Notes column (e.g. "Depends on 01-006").
