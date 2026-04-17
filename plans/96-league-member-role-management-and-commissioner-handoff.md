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
| 96-001 | 1 | Product review of league member role management and commissioner handoff rules | Done | PoolMaster now supports in-app commissioner promotion/demotion, member removal, and a truthful blocked-leave message when the last commissioner tries to leave. |
| 96-002 | 1 | Backend review of required leave-guard and member-role rules | Done | MemberService now blocks any demotion/removal/leave that would leave a league without an active commissioner and returns a stable `LEAGUE_LAST_COMMISSIONER_REQUIRED` error. |
| 96-003 | 2 | Frontend developer: implement league member role management UI | Done | The league home roster now shows commissioner-facing promote, demote, and remove actions directly in the member list. |
| 96-004 | 2 | Frontend developer: surface commissioner handoff guidance in the leave flow | Done | The league home now includes a membership-actions card with a real leave flow and a clear handoff explanation for the last commissioner. |
