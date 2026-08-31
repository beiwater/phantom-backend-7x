---
name: deep-root-cause-debugging
description: "Depth-first root-cause debugging and verification for SimCompanies private server. Enforces complete root-cause chain tracing, Issue #68 architectural boundaries, atomic database mutations, idempotency, isolated fix execution, and independent VERIFY_ONLY checks."
---

# Deep Root Cause Debugging Skill

## 1. Core Philosophy: Depth-First Single Issue Focus
Deep Debugger investigates and resolves exactly one issue at a time.
- **Rule of Single Focus**: If an unrelated bug is spotted during debugging, output it as a new candidate finding to the Orchestrator backlog. NEVER switch tasks mid-stream.
- **No Superficial Patches**: An issue is not solved by suppressing a UI warning, returning a dummy 200 response, or modifying the original frontend bundle.
- **Root Cause Chain**:
  `Visible DOM -> Network Request -> Payload -> HTTP Route -> Application Use Case -> Domain Invariant -> Repository / DB -> Response Schema -> Frontend State -> Refresh Persistence`

## 2. Issue #68 Architectural Boundaries
All fixes must adhere to the layered system architecture:
1. **Compatibility Adapter (`server/compatibility/`, `server/routes/`)**:
   - Parses HTTP requests and maps original frontend parameter conventions.
   - Formats DTOs (`moneyUpdate`, `dbLetter`, `v1/v2` aliases).
   - Keeps legacy protocol quirks contained so core domain models stay clean.
2. **Application Use Case (`server/application/`)**:
   - Owns the transaction lifecycle (`db.transaction(...)`).
   - Authenticates and authorizes via `GameContext`.
   - Coordinates domain models and repositories.
3. **Domain Layer (`server/domain/`)**:
   - Authoritative business rules (leveling, building slots, resource compatibility, queue limits).
   - Independent of HTTP or SQLite specifics.
4. **Repository Layer (`server/repositories/`, `server/db/`)**:
   - SQL queries, schema constraints, transaction boundaries.
5. **Event Bus (`server/events/`) Boundary**:
   - Event Bus MUST ONLY receive events AFTER transaction commit.
   - Non-critical side-effects only (achievements, chat notifications, stats projections).
   - Core economic mutations (money, inventory, buildings, orders) MUST remain synchronous and transactional.

## 3. Database Integrity & Idempotency Principles
- **Atomic Mutations**: Multi-step operations (e.g. deduct input resources + deduct cash + create queue) must occur within an atomic database transaction.
- **Idempotency**: Retrying an action (e.g. claim finished production, collect reward, fulfill order) must yield identical outcomes without duplicate cash or item minting.
- **No Hidden DB Writes on GET**: Read/GET endpoints must never perform implicit side-effect writes.
- **Canonical Game Data**: Always use canonical definitions from `server/game-data/` rather than hardcoding resource IDs or building capacities.

## 4. Operating Modes

### Mode A: FIX
1. **Reproduce First**: Confirm the symptom reproduces in isolation.
2. **Trace Root Cause**: Pinpoint the faulty layer in the root-cause chain.
3. **Implement Minimum Viable Fix**: Modify backend code following Issue #68 boundaries.
4. **Unit / Contract Test**: Add a targeted invariant or contract test.
5. **Small Commit**: Keep commits atomic and descriptive (e.g. `fix(production): enforce input resource requirement on start`).

### Mode B: VERIFY_ONLY (Independent Auditor)
1. Runs in a fresh session with NO shared context from the fixing phase.
2. Re-plays the exact user-visible action sequence that triggered the finding.
3. Inspects DOM state, network response, and refresh persistence.
4. Validates that the invariant holds.
5. Returns independent proof (PASS with evidence, or FAIL with logs).

## 5. Prohibited Practices
- **DO NOT** patch `frontend-original/` to work around server schema deficiencies.
- **DO NOT** perform large unrelated refactorings or introduce complex new frameworks.
- **DO NOT** skip independent browser/runtime verification before declaring a fix complete.
