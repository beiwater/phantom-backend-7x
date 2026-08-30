---
name: economy-integrity
description: Audit and repair SimCompanies money, SimBoosts, inventory, rewards, ownership, idempotency, and transaction consistency across player actions and persistence.
---

# Economy and state integrity

Use this skill for any change involving money, SimBoosts, inventory/materials, rewards, production, market/retail, slots, building state, contracts, achievements, or other persisted player progression.

## Core invariant

Every player action must preserve:

```text
validated actor/ownership
+ validated preconditions
+ exact resource deltas
+ atomic state mutation
+ correct response balance/state
+ refresh-stable persistence
```

A UI that looks correct once is not sufficient.

## Audit patterns

Search for these bug classes proactively, not only after a failing page is reported.

### Delta versus absolute balance

Understand helper contracts before calling them. If `updateCompanyMoney(companyId, delta)` adds a delta, never pass an already-computed absolute balance such as `current + revenue`.

Apply the same review to SimBoosts, experience, inventory and counters.

### Ignored failure results

If helpers such as `consumeResource()` return false/null on failure, the caller must stop the operation. Never award money, create an order/building, or advance progress after a failed prerequisite.

### All-or-nothing requirements

Construction, upgrades, production inputs and purchases must preflight all required resources. Do not consume whichever materials happen to exist and continue with missing requirements.

### Idempotency and replay

Claims, rewards, collect, rush, purchases, contract transitions and similar one-time actions must not pay twice when the same request is repeated/retried. Reject unknown reward IDs instead of falling back to a valid reward.

### Authentication and ownership

Every state-changing POST/PUT/PATCH/DELETE must operate on the authenticated company/player and verify ownership of referenced buildings, queues, orders, contracts and other entities. Never use a hard-coded fallback company for writes.

### Atomic multi-state changes

Use DB transactions when an operation touches multiple durable states, for example inventory + money + order deletion. Failure must leave all participating state unchanged.

### Persisted value versus hard-coded response

If slots, balances, tags, levels, modifiers or similar values are persisted, auth/company responses must read those fields. Do not reset them to constants after refresh.

### Clamp helpers

Helpers that clamp balances with `Math.max(0, ...)` must not be used as a substitute for precondition checks. Validate sufficient funds/SimBoosts first; otherwise an invalid debit can silently succeed at zero.

## Verification matrix

For every economic mutation, verify at least:

- visible pre-action balance/inventory/state;
- action through visible DOM;
- request payload;
- exact expected delta;
- response balance/schema;
- visible post-action state;
- persisted state after refresh/relogin;
- repeat action/retry behavior where idempotency matters;
- insufficient-funds/materials path;
- cross-company/guest rejection where applicable.

Use database inspection only as diagnostic evidence, never to manufacture the player state for the first exploratory pass.

## Severity

Treat infinite money/SimBoosts, duplicate rewards, inventory-free revenue, cross-company mutation, and partial-state corruption as P0. Treat refresh resets, wrong balance fields, missing material enforcement and important schema/state mismatch as P1 unless impact justifies P0.

After fixing, replay through the real UI and add a DOM-only regression that proves the player-visible invariant.
