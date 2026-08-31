---
name: game-state-exploration
description: "Breadth-first coverage-guided game state exploration for SPA and state machines. Guides normalized state fingerprinting, BFS frontier selection, novelty scoring, multi-dimensional coverage, invariant auditing, and structured finding generation."
---

# Game State Exploration Skill

## 1. Core Philosophy: SPA State Machine Exploration
SimCompanies is a Single Page Application (SPA) driven by an authoritative economic state machine.
- URL is NOT a node identity. Multiple distinct game states share the same URL.
- DOM structural similarity does NOT imply state equivalence.
- Transition unit: `Observable Game State + Visible Player Action -> New Observable Game State`.
- Exploration goal: Flood the state graph like water (Breadth-First Search) across valid backbone transitions, invalid transitions, boundary limits, and cross-subsystem interactions.

## 2. Normalized State Fingerprint
Every stable UI state must be mapped to a deterministic `state_fingerprint` hash/string composed of:
1. `screen_family`: (e.g. `realm_map`, `building_detail`, `warehouse_grid`, `market_order_book`, `research_tree`, `executive_board`, `bonds_desk`)
2. `entity_type`: (e.g. `plantation`, `farm`, `power_plant`, `retail_store`, `water_well`)
3. `entity_id`: stable identifier or slot index if applicable
4. `business_state`: (`idle`, `producing`, `finished`, `blocked`, `upgrading`, `demolishing`)
5. `active_modal`: identifier of open dialog/modal or `none`
6. `active_tab`: selected sub-navigation tab
7. `visible_actions`: sorted list of visible action identifiers with enabled status (`[action_name:enabled|disabled]`)
8. `queue_bucket`: (`empty`, `partial`, `full`)
9. `economy_bucket`: (`sufficient_funds`, `insufficient_funds`, `zero_balance`)
10. `alert_state`: visible error/warning banners

### Noise Filtering (MUST Ignore / Strip)
- Countdown timers ticking every second
- Absolute timestamps / date strings
- Dynamic/random CSS animation classes
- Auto-generated ephemeral React IDs
- Fluctuating non-semantic counters

## 3. BFS Frontier Queue & Novelty Scoring
Maintain an external queue of `(state_fingerprint, action)` candidates.
Prioritize items with higher **Novelty Score**:
- `+50`: Unseen `state_fingerprint`
- `+30`: New endpoint or HTTP method triggered
- `+30`: New modal, tab, or state family reached
- `+25`: New business invariant tested
- `+20`: Cross-system interaction path
- `+15`: Unseen visible action
- `+10`: Unexplored boundary condition

## 4. Four Exploration Waves
1. **Wave 1: Backbone Transitions**
   - Valid lifecycle: `idle -> start -> producing -> finished -> collect -> idle`
   - Secondary paths: `producing -> cancel`, `producing -> rush`
2. **Wave 2: Invalid Transitions**
   - Cannot demolish/upgrade while producing/busy
   - Cannot double-collect finished production
   - Cannot start production without required input resources or funds
   - Cannot cancel another company's market order
3. **Wave 3: Boundary Limits**
   - 0 quantity / required - 1 / exact required / queue max
   - Insufficient funds / insufficient inventory / max slot unlock
4. **Wave 4: Cross-Subsystem Interactions**
   - Production inputs purchased from Market
   - Retail sales consuming Warehouse stock
   - Research bonus affecting Production costs

## 5. Invariant Auditing
Fail the transition if any of the following global invariants are violated:
- **INV-MONEY**: Money must never become NaN, undefined, or drop unexpectedly without receipt.
- **INV-INVENTORY**: Stock quantities must never be negative or duplicate on collection.
- **INV-ATOMICITY**: Failed requests must not leave partial mutations in state or UI.
- **INV-IDEMPOTENCY**: Repeated clicks or duplicate submissions must not double-credit rewards or cash.
- **INV-AUTHZ**: Company cannot read, edit, or reset another company's private entities.
- **INV-PERSISTENCE**: State must survive a full page refresh without rolling back.
- **INV-RUSH-COST**: Rush action on idle buildings must not charge money or SimBoosts.

## 6. Prohibited Practices (Strict Guardrails)
- **DO NOT** edit, write, or patch code during exploration.
- **DO NOT** directly call backend business APIs or execute SQL queries to fabricate states.
- **DO NOT** inject JavaScript into Redux stores or modify `localStorage`.
- **DO NOT** treat HTTP 200 `[]` or 200 `{}` as successful feature implementations.
- **DO NOT** guess root causes; report observed symptoms and suspected scope only.

## 7. Structured Finding Schema
When a transition fails, record an entry in `findings.jsonl`:
```json
{
  "finding_id": "FINDING-YYYYMMDD-XXX",
  "subsystem": "production | buildings | market | retail | warehouse | simboosts | auth",
  "starting_state": "<state_fingerprint>",
  "action": "<visible_player_action>",
  "expected_transition": "<expected_next_state_or_behavior>",
  "observed_transition": "<observed_behavior_or_error>",
  "ui_evidence": "<selector_or_text_summary>",
  "network_evidence": { "method": "POST", "url": "/api/v2/...", "status": 500, "response": {} },
  "console_error": "<error_message>",
  "invariant_violated": "INV-...",
  "refresh_persistence_checked": true,
  "reproduction_count": 1,
  "severity": "P0 | P1 | P2 | P3",
  "novelty_score": 45,
  "suspected_scope": "server/routes/... (suspected only)"
}
```
