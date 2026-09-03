> [!IMPORTANT]
> ## AI AGENT BOOTSTRAP — COMPLETE THIS BEFORE REPOSITORY WORK
>
> If you are an AI coding agent, this block is an operational repository instruction, not optional documentation. Before searching the repository, reading implementation files, modifying code, running tests, reviewing changes, or proposing implementation details:
>
> 1. Read and follow [`AGENTS.md`](./AGENTS.md).
> 2. Read [`.codex/README.md`](./.codex/README.md) completely.
> 3. Load every task-relevant `.codex/skills/*/SKILL.md` file before implementation.
> 4. For any debugging, bug fixing, investigation, or code-change task, load `.codex/skills/evidence-first-investigation/SKILL.md` by default.
> 5. Only then begin targeted repository inspection, implementation, or testing.
>
> Do **not** start by reading the whole repository or enumerating directories to understand the architecture. Do **not** bypass the skill bootstrap because the task appears simple. If the required instruction files cannot be read, report the blockage instead of silently inventing a replacement workflow. Higher-priority platform/system/developer/user instructions remain controlling.

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

## Virtual Time

- Time-gated business logic reads `server/core/virtual-clock.ts`; production,
  construction, launches, retail, contracts, restaurants, auctions, and
  government orders therefore observe the same virtual timestamp as
  `/api/v2/time-millis/`.
- The offset is process-wide and intentionally shared by all realms served by
  that process. Separate service instances have separate offsets; target the
  intended instance with `TIME_WARP_URL` (or `BASE_URL`).
- `scripts/dev-tool.ts warp` calls the running instance's
  `POST /api/v2/debug/time-warp/`; it never mutates a different process's
  in-memory clock. A restart resets the offset unless `CLOCK_OFFSET_MS` is
  supplied during startup.
- The landscape/map layout is static data. It does not change after a time
  warp; completion, queue, deadline, and settlement APIs are the authoritative
  observable state.


## API Endpoints

All core REST endpoints implemented across compatibility route handlers:

### Authentication & Profile (`/api/v1/auth/`, `/api/v2/auth/`, `/api/v1/companies/`)
- `POST /api/v2/auth/email/connect/` — Register / login with email & password
- `POST /api/v2/auth/logout/` — End current session
- `GET /api/v1/auth/user/` — Current logged-in user profile & state
- `GET /api/v1/companies/me/` — Active company profile, level, money, simboosts
- `PATCH /api/v1/companies/me/` — Update company settings, notes, theme

### Buildings & Production (`/api/v1/buildings/`, `/api/v2/order/`)
- `GET /api/v1/buildings/` — List all company buildings
- `POST /api/v1/buildings/` — Construct new building
- `POST /api/v1/buildings/:id/upgrade/` — Upgrade existing building
- `POST /api/v1/buildings/:id/demolish/` — Demolish building
- `POST /api/v2/order/start/` — Start production queue
- `POST /api/v2/order/cancel/:id/` — Cancel queued production
- `POST /api/v2/order/take/:id/` — Collect finished goods into warehouse
- `POST /api/v2/order/rush/:id/` — Rush production using SimBoosts

### Warehouse & Inventory (`/api/v1/warehouse/`)
- `GET /api/v1/warehouse/` — Query inventory resources and quantities
- `GET /api/v1/warehouse/:id/` — Detail for specific inventory slot

### Market & Exchange (`/api/v1/market/`, `/api/v2/market/`, `/api/v3/market/`)
- `GET /api/v3/market/:realm/:resource/` — Market listings for a given resource kind
- `POST /api/v2/market/orders/` — Post market sell order
- `POST /api/v2/market/buy/` — Buy order fulfillment
- `DELETE /api/v2/market/orders/:id/` — Cancel active market order

### Contracts (`/api/v1/contracts/`, `/api/v2/contracts/`)
- `GET /api/v1/contracts/` — List incoming & outgoing contracts
- `POST /api/v1/contracts/` — Send contract to another company
- `POST /api/v1/contracts/:id/accept/` — Accept contract
- `POST /api/v1/contracts/:id/reject/` — Reject/cancel contract

### Bonds & Banking (`/api/v1/bonds/`)
- `GET /api/v1/bonds/` — List company bonds & market bonds
- `POST /api/v1/bonds/issue/` — Issue new bonds
- `POST /api/v1/bonds/:id/buy/` — Buy bonds from exchange
- `POST /api/v1/bonds/:id/call/` — Call (repay) issued bonds

### Executives & Board (`/api/v1/executives/`)
- `GET /api/v1/executives/` — List company executives
- `POST /api/v1/executives/hire/` — Hire new executive candidate
- `POST /api/v1/executives/:id/assign/` — Assign executive to position (COO, CFO, CMO, CTO)
- `POST /api/v1/executives/:id/train/` — Train executive skill
- `DELETE /api/v1/executives/:id/` — Fire executive

### Research & Patents (`/api/v1/research/`)
- `GET /api/v1/research/` — Query company research disciplines and patent levels
- `POST /api/v1/research/apply/` — Apply research points to unlock patent tier

### Achievements & Rewards (`/api/v1/achievements/`)
- `GET /api/v1/achievements/` — List player achievement progression
- `POST /api/v1/achievements/:id/claim/` — Claim unlocked achievement rewards

### Social, Newspaper & Chat (`/api/v1/social/`, `/api/v1/newspaper/`, `/api/v1/chat/`)
- `GET /api/v1/newspaper/:realm/latest/` — Latest newspaper issue and articles
- `GET /api/v1/chat/messages/` — Query chat history for channel
- `POST /api/v1/chat/messages/` — Send chat message

## Cookies and Session Management

The test suite includes session cookie helpers:

```bash
# Save/verify session cookie
npm run test:cookie
```

Session tokens are stored in `tests/cookies.json` as:
```json
[
  {
    "name": "sessionid",
    "value": "<session_token>",
    "domain": "127.0.0.1",
    "path": "/"
  }
]
```
Browser E2E scripts load this cookie to bypass the login screen and resume active player sessions directly.

## Database Structure

Core SQLite tables (`simcompanies.sqlite`):

| Table | Key Fields | Description |
| --- | --- | --- |
| `players` | `id`, `player_id`, `email`, `password_hash`, `is_admin` | Player accounts and credentials |
| `sessions` | `session_token`, `player_id`, `active_company_id`, `expires_at` | Active authentication sessions |
| `companies` | `company_id`, `player_id`, `name`, `money`, `simboosts`, `level` | Company profiles and economic state |
| `buildings` | `id`, `company_id`, `position`, `kind`, `size`, `busy_until` | Physical buildings constructed on map |
| `production_queues` | `id`, `building_id`, `company_id`, `kind`, `cost`, `amount`, `finishes_at` | In-flight and completed production |
| `retail_orders` | `id`, `building_id`, `company_id`, `resource_kind`, `units`, `unit_price` | Active retail sales queues |
| `warehouse` | `id`, `company_id`, `kind`, `quality`, `amount`, `cost_workers` | Company resource inventories |
| `market_orders` | `id`, `seller_id`, `kind`, `quality`, `quantity`, `price`, `active` | Active and fulfilled market listings |
| `contracts` | `id`, `sender_company_id`, `recipient_company_id`, `kind`, `amount`, `price`, `status` | Direct B2B contracts |
| `bonds` | `id`, `seller_company_id`, `buyer_company_id`, `amount`, `interest_rate`, `status` | Financial bonds and liabilities |
| `executives` | `id`, `company_id`, `name`, `position`, `skill_management`, `salary`, `status` | Hired company management team |
| `research` | `id`, `company_id`, `discipline`, `points`, `patents` | Research investment and quality levels |

## License

MIT License. Free and open source for private, educational, and self-hosted compatibility use.
