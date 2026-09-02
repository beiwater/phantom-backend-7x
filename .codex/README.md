# SimCompanies Private Server — Codex Project Guide

> [!IMPORTANT]
> ## Mandatory agent bootstrap
>
> If you are an AI coding agent working in this repository, this guide is an operational instruction layer, not optional background reading. Before inspecting implementation code, searching broadly, editing files, running tests, reviewing changes, or proposing implementation details, select and load the applicable skills from `.codex/skills/`.
>
> For every debugging, bug-fixing, investigation, or code-change task, load `evidence-first-investigation` first. Add the domain-specific skills required by the task. Do not skip skill loading because the task appears small. Do not begin by reading the entire repository.
>
> If a required skill cannot be accessed, report that limitation instead of silently proceeding with an improvised workflow. Higher-priority platform/system/developer/user instructions still take precedence over repository-local instructions.

This repository is maintained as a compatibility reconstruction of the original SimCompanies web client against a private backend. The completion standard is real playability, not merely HTTP 200 responses or pages that render without crashing.

## Execution model

Use the project skills under `.codex/skills/` as the canonical workflow:

- [`simcompanies-private`](./skills/simcompanies-private/SKILL.md) — overall execution loop and project priorities.
- [`simcompanies-e2e`](./skills/simcompanies-e2e/SKILL.md) — real-browser exploratory E2E and DOM-only regression testing.
- [`compatibility-api`](./skills/compatibility-api/SKILL.md) — infer and implement original frontend API contracts from Network/HAR/frontend usage.
- [`decompile-evidence-reuse`](./skills/decompile-evidence-reuse/SKILL.md) — reuse verified frontend/decompile evidence before opening minified bundles; only perform narrow anchored decompilation when a required contract fact is still missing, then persist the finding for future agents.
- [`missing-api-recorder`](./skills/missing-api-recorder/SKILL.md) — record missing/fake APIs, schema mismatches, empty fallbacks, loading failures, and state inconsistencies.
- [`economy-integrity`](./skills/economy-integrity/SKILL.md) — audit money, SimBoosts, inventory, rewards, idempotency, ownership, and transactional state changes.
- [`code-standards`](./skills/code-standards/SKILL.md) — enforce code formatting, anti-reinvention reuse rules, comments, ~500-line modularity boundaries, and verified Git delivery timing.
- [`evidence-first-investigation`](./skills/evidence-first-investigation/SKILL.md) — keep narrow issue work evidence-first: targeted search, small working sets, explicit reading budgets, early hypothesis testing, and scope expansion only when causally justified.

### Skill loading rules

Load skills before implementation, not after a broad repository survey.

- Any debugging / bug fix / investigation / code modification → `evidence-first-investigation`.
- Any production code modification → also `code-standards`.
- General SimCompanies private-server task → also `simcompanies-private`.
- Real browser, DOM, gameplay, screenshot, HAR, or regression verification → also `simcompanies-e2e`.
- API contract / frontend-backend compatibility → also `compatibility-api` + `decompile-evidence-reuse`.
- Any task that may otherwise require reading `frontend-original` minified bundles → `decompile-evidence-reuse` before bundle inspection.
- Missing/fake/fallback API behavior → also `missing-api-recorder`.
- Money, inventory, SimBoosts, rewards, ownership, transactions, or economic integrity → also `economy-integrity`.

When several categories apply, load the combination. The skill router is intentionally additive.

Core loop:

```text
Real player DOM exploration
→ observe Network/Console/UI state
→ record evidence
→ create/update Issue
→ reuse existing compatibility/decompile knowledge first
→ only if a contract fact is missing, perform narrow anchored frontend/HAR investigation
→ trace route/service/DB/schema root cause
→ fix real game logic
→ persist any newly discovered compatibility evidence
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
- Before reading minified frontend code, search existing decompile evidence, canonical game data, related tests, and Issue history. Do not repeatedly re-derive already verified contracts without a concrete conflict reason.
- Fix root causes rather than patching only the currently visible page.
- Do not weaken or bypass the agent bootstrap or skill-loading rules during unrelated implementation work.

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
- Decompile evidence reuse / compatibility knowledge registry: [Issue #162](https://github.com/beiwater/phantom-backend-7x/issues/162)

When working on the project, read current Issues and recent commits before implementing anything so existing functionality is reused rather than duplicated. Apply that step after loading the relevant skills, and keep the investigation scoped according to `evidence-first-investigation` rather than surveying unrelated issues or code.
