# SimCompanies Private Server — Codex Project Guide

This repository is maintained as a compatibility reconstruction of the original SimCompanies web client against a private backend. The completion standard is real playability, not merely HTTP 200 responses or pages that render without crashing.

## Execution model

Use the project skills under `.codex/skills/` as the canonical workflow:

- [`simcompanies-private`](./skills/simcompanies-private/SKILL.md) — overall execution loop and project priorities.
- [`simcompanies-e2e`](./skills/simcompanies-e2e/SKILL.md) — real-browser exploratory E2E and DOM-only regression testing.
- [`compatibility-api`](./skills/compatibility-api/SKILL.md) — infer and implement original frontend API contracts from Network/HAR/frontend usage.
- [`missing-api-recorder`](./skills/missing-api-recorder/SKILL.md) — record missing/fake APIs, schema mismatches, empty fallbacks, loading failures, and state inconsistencies.
- [`economy-integrity`](./skills/economy-integrity/SKILL.md) — audit money, SimBoosts, inventory, rewards, idempotency, ownership, and transactional state changes.
- [`code-standards`](./skills/code-standards/SKILL.md) — enforce code formatting, anti-reinvention reuse rules, comments, ~500-line modularity boundaries, and verified Git delivery timing.

Core loop:

```text
Real player DOM exploration
→ observe Network/Console/UI state
→ record evidence
→ create/update Issue
→ trace route/service/DB/schema root cause
→ fix real game logic
→ replay manually
→ add DOM-only Playwright regression
→ commit/push
→ continue exploring
```

## Non-negotiable rules

- `200 []`, `200 {}`, `{success:true}`, fake data, and generic `/api/*` fallbacks are not successful implementations.
- First discovery of a gameplay problem must come from real browser interaction through visible DOM controls.
- Do not create E2E state by directly calling business APIs, modifying the database, injecting JavaScript, or editing localStorage.
- Money, SimBoosts, inventory, buildings, production queues, rewards, slots, orders, and ownership must be validated as persisted state and must remain correct after refresh.
- Use HAR / Network / frontend bundle consumption as evidence for compatibility response schemas; do not invent fields just to silence frontend errors.
- Fix root causes rather than patching only the currently visible page.

## Toolchain

Primary tools:

```text
Chromium / Chrome Headless Shell
Chrome DevTools / CDP
Playwright
Network / HAR
Console / PageError
Screenshot / Trace
rg / grep / jq
SQLite inspection
Git / GitHub Issues
```

Reusable project tooling belongs under `scripts/`, `tests/e2e/`, and related evidence/report directories rather than being recreated ad hoc.

## Project tracking

- Project execution contract: [Issue #57](https://github.com/beiwater/phantom-backend-7x/issues/57)
- Missing API/Data recorder implementation: [Issue #58](https://github.com/beiwater/phantom-backend-7x/issues/58)

When working on the project, read current Issues and recent commits before implementing anything so existing functionality is reused rather than duplicated.
