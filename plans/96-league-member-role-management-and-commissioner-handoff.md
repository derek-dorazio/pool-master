## Purpose

Track the league member-management follow-on work that is required to make
co-commissioner promotion and commissioner leave rules usable in the real app.

## Why This Exists

- The backend already supports changing a league member's role to
  `COMMISSIONER`.
- PoolMaster does not yet expose a UI for member role management.
- The current `leaveLeague` flow does not yet block the last commissioner from
  leaving without first appointing another commissioner.

## Starter User Cases

### LM-001: Commissioner promotes a member to co-commissioner

**Actor:** Commissioner

**Preconditions**
- Actor is an active commissioner in the league
- Target user is an active league member

**Flow**
1. Commissioner opens league member management
2. Commissioner selects a member
3. Commissioner promotes the member to commissioner
4. System updates the member role and reflects the new commissioner status in
   the UI

**Expected outcomes**
- Multiple active commissioners are supported truthfully
- The promoted member can use commissioner-only league features

### LM-002: Last commissioner attempts to leave without appointing another commissioner

**Actor:** Commissioner

**Preconditions**
- Actor is the only active commissioner in the league

**Flow**
1. Commissioner attempts to leave the league
2. System checks whether another active commissioner exists
3. System blocks the leave action and explains that another commissioner must
   be appointed first

**Expected outcomes**
- A league never loses all commissioner coverage through self-service leave
- The leave rule is enforceable from the real app, not just documented

## Execution Notes

- This should be implemented after the current team-management lane is in a
  reviewable state.
- The work likely belongs in the league member-management surface rather than
  the team lane.

## Task Table

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 96-001 | 1 | Product review of league member role management and commissioner handoff rules | Not Started | Add truthful in-app flow for promoting members to commissioner and blocking the last commissioner from leaving until another commissioner exists. |
| 96-002 | 1 | Backend review of required leave-guard and member-role rules | Not Started | Confirm backend role-change capability, add last-commissioner leave guard, and review related error semantics before frontend work. |
| 96-003 | 2 | Frontend developer: implement league member role management UI | Not Started | Add commissioner-facing promote/demote controls in the league member-management surface. |
| 96-004 | 2 | Frontend developer: surface commissioner handoff guidance in the leave flow | Not Started | Make leave-blocking actionable and understandable from the real app. |
