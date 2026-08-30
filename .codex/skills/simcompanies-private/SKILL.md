---
name: simcompanies-private
description: Coordinate continuous exploration, compatibility reconstruction, issue-driven repair, evidence, regression, and Git delivery for the SimCompanies private server.
---

# SimCompanies Private Server execution

Use this as the umbrella skill for work in this repository. The completion standard is not HTTP 200 or a rendered shell. A feature is complete only when a real player action produces the correct request, backend/game mutation, persisted database state, response schema, visible UI update, and refresh-stable result.

## Start here

Before changing code, inspect recent commits, open GitHub Issues, `server/`, database schema, `tests/`, `scripts/`, and `.codex/skills/`. Reuse existing implementations and tooling. Do not replace working behavior with mocks or generic fallbacks.

Use the specialist project skills together:

- `simcompanies-e2e`: real-browser exploratory testing and DOM-only regression.
- `compatibility-api`: infer and implement the exact original-client API contract from Network/HAR/frontend consumption.
- `missing-api-recorder`: capture missing/fake APIs and schema/state observations during exploration.
- `economy-integrity`: audit money, SimBoosts, inventory, ownership, idempotency, and multi-state transactions.
- `code-standards`: enforce code formatting, anti-reinvention reuse rules, comments, ~500-line modularity boundaries, and verified Git delivery timing.
Primary tracking issues: #57 defines the continuous repair workflow; #58 defines the missing API/data recorder.

## Continuous loop

Always work in this loop:

```text
Explore visible UI
→ observe Network/Console/state
→ record evidence
→ create/update a focused Issue
→ trace route → game logic → DB → response
→ fix the root cause
→ replay manually through DOM
→ refresh and verify persistence
→ add/update DOM-only Playwright regression
→ commit
→ continue exploring
```

Do not defer all fixes until after exploration. When a reproducible root cause is found, repair it, replay it, then continue traversal.

## Player-state traversal

Treat the frontend as a state graph:

```text
UI State → User Action → Request → Route → Game Logic → DB → Response → New UI State
```

Traverse meaningful reachable states across auth, company, buildings, construction, upgrade/demolition, production/collect/rush, warehouse, market, retail, contracts, SimBoosts, slots, executives, achievements, encyclopedia, rankings, newspaper, finance/social, government, restaurant, aerospace, tabs, dropdowns, modals, forms and pagination.

A page visit alone is not coverage. Exercise visible controls and follow resulting states.

## Failure definition

Treat all of these as failures when the UI expects real behavior:

- `200 []`, `200 {}`, `{success:true}` from a fake/generic fallback.
- wrong field names/types or missing nested structures.
- money/SimBoosts/inventory/building/queue state not changing correctly.
- UI not updating after a nominally successful response.
- refresh losing state.
- blank content, infinite loading, `undefined`, `NaN`, fatal Console/PageError.
- action succeeding for the wrong company/player or without authentication.

## Priorities

Prioritize player-visible economic and progression correctness: Money/SimBoosts, achievements, rush, construction materials, land/building slots, retail/market, executives, encyclopedia/rankings/newspaper, then placeholder modules such as government/restaurant/aerospace.

## Delivery gate

Before considering a repaired feature done, require: manual exploratory replay through visible DOM; correct request/response semantics; correct persisted state after refresh; no fatal browser errors; DOM-only Playwright regression; evidence artifacts where useful; focused commit; and an updated list of remaining unimplemented/fake APIs and the five most serious player-visible problems.
