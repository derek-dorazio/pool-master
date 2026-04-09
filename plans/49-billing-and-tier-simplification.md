# Plan 49: Billing Removal And Future Tier Deferral

## Purpose

Remove the current billing subsystem entirely for the first-pass backend
refactor and explicitly defer all tiering, payment, and monetization design
until there is a real product consumer.

The product is free-first, and there is no need to preserve placeholder billing
or tier structures in the core model right now.

## First-Pass Product Definition

The product launches as fully free.

Important boundary:

- there is no billing subsystem in the first pass
- there is no tier field in the first pass
- there is no payment provider in the first pass
- there is no subscription lifecycle in the first pass
- there is no usage enforcement in the first pass

If tiering becomes important later, it can be added on top of the simplified
league-first model once there is an actual consumer.

## Locked Direction

The following is considered settled for the first pass:

- the product is fully free
- no Stripe or payment provider integration is needed
- no billing portal, invoicing, trials, dunning, or subscription lifecycle is needed
- no usage enforcement is needed
- no plan or tier enum is needed yet
- no placeholder license object is needed yet
- no billing subsystem should remain in the active backend model

## Current Model Areas To Remove

These persisted models are no longer aligned with the target direction and
should be removed from the first-pass backend refactor:

- `PlanTier`
- `TenantUsage`
- `EntitlementOverride`
- `TenantSubscription`

## Current Billing Services To Remove Or Defer

These modules should be removed or deferred from first-pass implementation:

- `billing-feature-gate.ts`
- `usage-service.ts`
- `entitlement-service.ts`
- `subscription-service.ts`
- `trial-service.ts`
- `plan-change-service.ts`
- `cancellation-service.ts`
- `dunning-service.ts`
- `invoice-service.ts`
- `revenue-analytics-service.ts`
- `enterprise-service.ts`
- `stripe-service.ts`
- `webhook-handler.ts`
- billing route module

Why:

- they are built around `Tenant`
- they assume Stripe-backed subscription operations
- they assume usage counting and entitlement checks
- they introduce complexity with no first-pass consumer

## Future Direction

When paid tiers or enforced limits become important later, the next phase can
introduce:

- a league tier enum
- formal tier definitions
- league-specific license/config interpretation
- limit enforcement in commissioner/service flows
- optional payment integration

None of those should shape current implementation choices.

## Implementation Guidance

Agents working on the backend-first refactor should:

- remove tenant-based billing and subscription concepts
- avoid preserving Stripe scaffolding "just in case"
- avoid rebuilding a generalized entitlement engine
- avoid adding placeholder tier/license structures with no consumer
- leave monetization and limits fully deferred until a real consumer appears

## Task Outline

| ID | Phase | Task | Status | Notes |
|---|---|---|---|---|
| 49-001 | 1 | Define first-pass product as fully free with no billing or tier model | Done | No `League.tier` needed yet |
| 49-002 | 1 | Remove tenant-based billing persistence models from target refactor model | Done | Removed tenant billing tables and `planTier` |
| 49-003 | 2 | Remove or defer Stripe, subscription, invoice, dunning, analytics, and entitlement services | Done | Removed billing services and entitlement guard |
| 49-004 | 2 | Remove billing routes and tenant plan-management flows from the active backend contract | Done | Removed billing/admin billing endpoints |
| 49-005 | 3 | Revisit league tiers only when a real product consumer exists | Done | Deferred entirely for first pass |

## Acceptance Criteria

- the first-pass backend contains no active billing subsystem
- the first-pass backend does not require Stripe or subscription lifecycle support
- no generalized entitlement or usage subsystem is required
- no tier enum or placeholder license object is required
- future monetization and limit semantics are explicitly deferred until needed
