# SimCompanies Private Server (phantom-backend-7x)

A compatibility / protocol re-implementation server for the original SimCompanies
frontend. The goal is not merely returning HTTP 200 — the bundled original
frontend must be genuinely playable against this backend: observable behaviors,
state machines, response schemas, economic constraints, and persistence semantics
must match the official server.

## Quick Start

```bash
# Start the server (Node 22+, type stripping enabled)
PORT=3100 node --experimental-strip-types server/index.ts

# Open the game
# http://127.0.0.1:3100/zh-cn/
```

Environment flags:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listen port |
| `DATA_DIR` | `./data` | SQLite database directory |
| `SPEED_MULTIPLIER` | `1` | Game time acceleration (dev/test) |
| `PAYMENTS_DISABLED` | unset | `1` makes all payment routes answer `501` with zero state change |
| `COOKIE_SECURE` | unset | `1` adds `Secure` to session cookies (HTTPS deployments) |
| `INITIAL_LEVEL` | `0` | Initial company level for new registrations |
| `ADMIN_PASSWORD` | random | Admin bootstrap password (generated & logged when absent) |

## Architecture

Layered design (Issue #68) — Compatibility → Application → Domain → Repository:

```
frontend-original/          Bundled original frontend (compatibility target)
server/
  router.ts                 Request entry; legacy handler dispatch chain
  http/route-registry.ts    Declarative route registry (strangler-fig migration)
  routes/                   HTTP handlers (compatibility DTO assembly)
  application/              Use cases (production, buildings, retail …)
  domain/                   Pure business rules (leveling, research, realms)
  game/                     Core game logic / repositories (market, warehouse …)
  game-data/                Canonical decompiled data tables
  db/                       SQLite connection, migrations, seed
  auth/                     Session lifecycle, password hashing
tests/                      Layered regression suites (unit + API + E2E)
scripts/                    Ops helpers (test gates, browser discovery …)
```

Core economic mutations (money, inventory, production, market orders, retail,
bonds, contracts, SimBoost spend) are synchronous, authoritative, and wrapped in
SQLite transactions. The event bus only carries after-commit side effects
(achievements, notifications, statistics, WebSocket projections).

## Testing

```bash
npm test          # layered gate: unit + API suites, then Playwright E2E
npm run test:unit # fast backend suites only
npm run test:api  # API/REST contract suites only
npm run e2e       # Playwright browser tests
```

Each `tests/verify-issue-*.test.ts` file defends one GitHub issue's contract and
is runnable standalone (`node --experimental-strip-types tests/verify-issue-N-…test.ts`);
most spawn an isolated server on a dedicated port with their own `DATA_DIR`.

## Issue Workflow

GitHub Issues are the long-lived work orders. Each fix lands with:

1. Reproduction against the real frontend behavior (not just API shapes).
2. A regression suite in `tests/` named after the issue.
3. Independent verification, then a small focused commit referencing the issue.

Continuous exploratory E2E and the AI debug workflow are described in
Issue #57 and the `.omp/` project workflow configuration.

## Compatibility Notes

- The original frontend is the compatibility target; the backend never patches
  `frontend-original/` to tolerate broken contracts. Legacy fields
  (`moneyUpdate`, `dbLetter`, v1/v2 aliases) are confined to compatibility DTO
  builders under `server/compatibility/` / route handlers.
- Unknown API routes answer `404 { code: 'API_NOT_FOUND' }`; wrong methods
  answer `405` with `Allow` headers. We never fake `200 []` for unimplemented
  endpoints.
- Decompile reference data lives in `server/data/decompile/` and
  `server/game-data/` and is the canonical source for formulas.
