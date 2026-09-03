---
name: code-standards
description: Enforce codebase formatting, anti-reinvention rules, precise code comments, file size boundaries (~500 lines), and Git push delivery timing.
---

# Code standards and engineering discipline

Use this skill to govern all code contributions, refactoring, architectural modularity, and Git delivery for the SimCompanies private server repository.

---

## 1. Code formatting & structural quality (代码格式与架构规范)

All code in this repository runs on modern Node.js (`v22+` / `v26+`) using native TypeScript type stripping (`--experimental-strip-types`) and ES Modules.

- **Module Resolution & Imports**:
  - Always use explicit extensions in relative imports (e.g., `import { CONFIG } from './config.ts'`).
  - Prefer Node.js built-in module prefixes: `node:fs`, `node:path`, `node:os`, `node:http`, `node:sqlite`, `node:crypto`.
  - Maintain consistent 2-space indentation, single quotes for strings, trailing commas where supported, and semicolons.

- **Type Safety & Contracts**:
  - Define explicit interfaces/types for all database rows, request bodies, game mutations, and API responses.
  - Do not use `any` as an escape hatch. Use `unknown` with runtime guards or explicit domain interfaces.
  - Route handlers must strictly conform to `(req, res, pathname, method, ...) => Promise<boolean>`, returning `true` when handled and `false` otherwise. Never return `sendJson(...)` directly without returning a boolean.

- **No Dead or Redundant Code**:
  - Delete obsolete shims, commented-out dead code blocks, unused imports, and unreferenced functions.
  - Avoid tiny single-expression wrapper functions that only rename a standard expression unless required for public API or shared by 3+ call sites.

---

## 2. Strict code reuse & anti-reinvention (严禁重复造轮子)

Before writing any new logic, helpers, or data models, **mandatory search and inspection** of existing files is required.

- **Game Models & Persistence Reuse**:
  - **Company & Balances**: Always reuse `updateCompanyMoney`, `updateCompanySimboosts`, `getCompanyById` in `server/game/company.ts`. Never write raw SQL updates for company balances across routes.
  - **Warehouse & Inventory**: Always reuse `consumeResourceWithTransactions`, `addResource`, `getWarehouseItem` in `server/game/warehouse.ts`.
  - **Buildings & Construction**: Always reuse `getBuildingById`, `formatBuilding`, `constructBuilding`, `upgradeBuilding` in `server/game/buildings.ts`.
  - **Production & Formulas**: Always reuse `calculateProductionTime`, `getResourceDef`, `getProductionQualityCap` in `server/game/constants.ts` and `server/game/research.ts`.

- **Static Data & Decompiled Mechanics**:
  - Consult `server/data/constants/` (`buildings.json`, `resources.json`, `core.json`) and `server/data/decompile/INDEX.md` (`formulas_*.md`, `economy_model.json`).
  - Never hardcode arbitrary formulas or invent new lookup tables when canonical definitions already exist in the decompiled data.

- **Shared Database & Utilities**:
  - Always reuse the single SQLite database instance `db` from `server/db/database.ts`. Never instantiate new `DatabaseSync` connections.
  - Always reuse `hashPassword`, `sendJson`, `readJsonBody`, `extractSessionToken`, and `getSession`.
  - **Schema Authority (Issue #177)**: versioned migrations in `server/db/migrations/runner.ts` are the single source of truth for business schema. Schema changes may ONLY be made by adding a new migration entry (`version: N+1`). Never add ad-hoc `CREATE TABLE` / `ALTER TABLE` to runtime modules (`server/game/`, `server/application/`, `server/repositories/`, `server/routes/`) or to `server/db/connection.ts` — connection.ts handles connection + PRAGMA only. Fresh databases must boot fully from migrations + seed.

---

## 3. Code comments & documentation (代码注释与文档规范)

Comments must communicate **intent, business rules, edge cases, formulas, and constraints ("Why")**, not re-state the TypeScript syntax ("What").

- **Issue & Compatibility Traceability**:
  - When fixing a compatibility bug, migration, or edge case, annotate the code with the relevant Issue number and reasoning:
    ```ts
    // Migration: add bond maturity columns if missing (issue #42)
    // Quality achievable at queue time, driven by research quality cap (#39)
    ```
- **Formula & Mechanics References**:
  - When implementing game formulas, reference the original specification or decompiled doc:
    ```ts
    // Retail sales speed calculation based on market saturation (formulas_retail.md §3.2)
    ```
- **Clarity on Non-Obvious Workarounds**:
  - Explain workarounds for original frontend quirks, Axios error handling, or browser-specific behaviors.
- **No Noisy or Redundant Comments**:
  - Prohibit self-evident comments like `// increment i` or `// return response`.
  - Ensure comments are updated or deleted when modifying the code they describe.

---

## 4. File size & modularity boundaries (~500 lines / 单文件规模规范)

To keep the codebase maintainable, readable, and cognitively manageable, maintain a soft limit of **~500 lines per file (target range: 300–600 lines)**.

- **Domain-Driven Modularization**:
  - **Routing Layer (`server/routes/`)**: Each domain (e.g. `market-routes.ts`, `building-routes.ts`, `auth-routes.ts`, `social-routes.ts`) must reside in its own dedicated handler. If a route file exceeds 500 lines, extract distinct sub-domains (e.g. split `finance-routes.ts` and `bond-routes.ts`).
  - **Business Logic Layer (`server/game/`)**: Separate game domain mechanics into cohesive modules (`production.ts`, `warehouse.ts`, `market.ts`, `bonds.ts`, `executives.ts`).
  - **Database Layer (`server/db/`)**: Keep table schema definitions and migrations cleanly structured; extract table-specific seeders when growth exceeds limits.
  - **Tests (`tests/` & `tests/e2e/`)**: Separate test scenarios into focused specifications (e.g. `private-server-flow.spec.ts`, `auth.spec.ts`, `market.spec.ts`) rather than creating a single multi-thousand-line monolithic test script.

- **Refactoring Trigger**:
  - When modifying a file that exceeds ~500 lines, proactively identify cohesive sub-responsibilities and extract them into sibling modules within the same architectural layer.

---

## 5. Git commit & cloud push timing (Git 提交与云端推送规范)

Clean, verified delivery gates are mandatory before pushing commits to the remote cloud repository.

### Commit Timing & Quality
- **Atomic Commits**: Commit when a single logical task, root-cause bug fix, or complete feature increment is completed and verified.
- **Conventional Commit Messages**: Use clear, concise commit messages following standard prefixes:
  - `feat(...)`: new game feature or compatibility API
  - `fix(...)`: bug fix or compatibility schema fix
  - `refactor(...)`: structural code improvement or file splitting
  - `test(...)`: new E2E or route validation tests
  - `docs(...)`: skill or project documentation updates

### Push Timing & Delivery Gates (云端推送时机与准入条件)
**NEVER push broken code or untested work to the remote repository.**

Before executing `git push` or `npm run git:auto-push`, all of the following verification gates **MUST PASS**:

1. **E2E Test Suite**:
   ```bash
   npm run e2e
   ```
   Must pass with 0 failures, 0 page errors, and verified state persistence.
2. **API Route Validation**:
   ```bash
   node --experimental-strip-types tests/verify-all-routes.ts
   ```
   All registered compatibility routes must respond with expected status codes and valid headers.
3. **Clean Code Inspection**:
   Ensure no stray debugging files, temporary scripts (e.g. `test-temp.js`), or unformatted syntax remain.
4. **Push Execution**:
   - Push to remote once the feature/fix is verified and committed.
   - Use `npm run git:auto-push` or `git push origin <branch>`.
   - Never leave completed, fully tested work uncommitted or unpushed across session boundaries.
