# Aerospace / Rocket System

> Extracted from: `chunk_D1r.js`, `chunk_Fci.js`, `chunk_Xoi.js`, `chunk_oX.js`, `entry.js`, `chunk_zjr.js`, `chunk_I6i.js`, `chunk_Pli.js`, `chunk_cJr.js`

---

## 1. Rocket Types & Stats

### 1.1 Rocket Products

| dbLetter | Resource | Produced At | Production Rate (base/hr) | Recipe | Tradable | Transportation |
|----------|----------|-------------|--------------------------|--------|----------|----------------|
| 91 | Sub-Orbital Rocket | Vertical Integration (9) | 3.0 | 1x Solid Rocket (85) + 1x Sub-Orbital 2nd Stage (90) | No | 20 |
| 92 | Orbital Booster | Aerospace Factory (7) | 5.0 | 40x Fuselage (77) + 16x Fuel Tank (84) + 34x Rocket Engine (86) | No | 100 |
| 93 | Starship | Aerospace Factory (7) | 1.0 | 2x Cockpit (81) + 4x Attitude Control (82) + 6x Fuel Tank (84) + 7x Rocket Engine (86) + 10x Heat Shield (87) | No | 100 |
| 94 | BFR | Vertical Integration (9) | 1.0 | 1x Orbital Booster (92) + 1x Starship (93) | No | 2000 |

### 1.2 Rocket Components

| dbLetter | Resource | Produced At | Production Rate (base/hr) | Recipe | Tradable |
|----------|----------|-------------|--------------------------|--------|----------|
| 83 | Rocket Fuel | Refinery (R) | 210.0 | 5x Water (1) + 1x Petroleum (74) | Yes |
| 84 | Fuel Tank | Aerospace Factory (7) | 15.0 | 50x Steel (18) + 250x Rocket Fuel (83) | Yes |
| 85 | Solid Rocket | Propulsion Factory (D) | 1.0 | 50x Planks (17) + 30x Steel (18) + 100x Rocket Fuel (83) | Yes |
| 86 | Rocket Engine | Propulsion Factory (D) | 1.0 | 10x Steel (18) + 20x Aluminum (43) + 8x High-Grade E-Components (79) | Yes |
| 87 | Heat Shield | Aerospace Factory (7) | 40.0 | 30x Timber (16) + 20x Aluminum (43) | Yes |
| 88 | Ion Drive | Propulsion Factory (D) | 2.0 | 15x Planks (17) + 30x Reinforced Concrete (22) + 8x High-Grade E-Components (79) | Yes |
| 89 | Jet Engine | Propulsion Factory (D) | 3.0 | 5x Steel (18) + 4x High-Grade E-Components (79) | Yes |
| 90 | Sub-Orbital 2nd Stage | Aerospace Factory (7) | 10.0 | 8x Fuselage (77) + 2x Flight Computer (80) + 2x Attitude Control (82) + 2x Fuel Tank (84) + 4x Ion Drive (88) | No |

### 1.3 Aerospace Component Materials

| dbLetter | Resource | Produced At | Production Rate (base/hr) | Recipe |
|----------|----------|-------------|--------------------------|--------|
| 76 | Carbon Composite | Aerospace Factory (7) | 10.0 | 4x Aramid (75) |
| 77 | Fuselage | Aerospace Factory (7) | 11.0 | 40x Carbon Composite (76) |
| 78 | Wing | Aerospace Factory (7) | 27.0 | 5x Steel (18) + 30x Carbon Composite (76) |
| 79 | High-Grade E-Components | Factory (L) | 4.0 | 4x Timber (16) + 3x Planks (17) + 0.0625x Processor (69) |
| 80 | Flight Computer | Aerospace Electronics (8) | 10.0 | 2x Microchip (47) + 4x High-Grade E-Components (79) |
| 81 | Cockpit | Aerospace Electronics (8) | 10.0 | 8x Glass (23) + 1x Processor (50) + 4x High-Grade E-Components (79) |
| 82 | Attitude Control | Aerospace Electronics (8) | 12.0 | 5x Reinforced Concrete (22) + 3x Aluminum (43) + 3x Electronics (48) |

### 1.4 Aerospace Research

| dbLetter | Resource | Produced At | Production Rate (base/hr) | Recipe | Tradable |
|----------|----------|-------------|--------------------------|--------|----------|
| 100 | Aerospace Research | Launch Pad (l) | 1.0 | 1x Sub-Orbital Rocket (91) + 1x BFR (94) | Yes |

Aerospace Research improves quality of all aerospace products (dbLetters 77-97):
Fuselage, Wing, High-Grade E-Components, Flight Computer, Cockpit, Attitude Control, Fuel Tank, Solid Rocket, Rocket Engine, Heat Shield, Ion Drive, Jet Engine, Sub-Orbital 2nd Stage, Sub-Orbital Rocket, Orbital Booster, Starship, BFR, Jumbo Jet, Luxury Jet, Single Engine Plane.

---

## 2. Launch Requirements

### 2.1 Rocket Launch Costs

| Rocket Type | Launch Cost (Aerospace Research units) |
|-------------|--------------------------------------|
| Sub-Orbital Rocket (91) | 400 |
| BFR (94) | 2,800 |

The launch cost is consumed as Aerospace Research (resource 100). Source: `k0 = [400, 2800]` in `chunk_zjr.js`.

### 2.2 Launch Pad Level Requirements

- Sub-Orbital Rocket: No level requirement (available from level 1)
- BFR: Requires Launch Pad **level 3 or higher** (from `pzr: "Requires launch pad level {level} or higher"` with level=3, in `chunk_Xoi.js`)

### 2.3 Launch Pad Max Level

Launch Pad size is limited to **level 8** (applied only to new constructions). Launch costs for Launch Pads over level 8 use the level 8 cost formula.

---

## 3. Launch Queue Mechanics

### 3.1 Queue Capacity

- **Maximum queue size**: 30 (`LAUNCH_QUEUE_MAX = 30`, from `chunk_oX.js` line 4959)
- Queue was gradually increased over time: 3 -> 6 -> 8 -> 12 -> 30

### 3.2 Queue Consumption

When a launch is **scheduled** (queued), the rocket is **consumed immediately** from inventory (not at launch time). This avoids launch queue failures caused by inventory shortages at launch time. (From changelog in `chunk_I6i.js`)

### 3.3 Queue Flow

1. Rocket is consumed from inventory when added to queue
2. The queue processes launches sequentially
3. Buildings set to busy state during launch production
4. After a launch completes, the building becomes free and the next queued launch begins
5. A 1-second delay is used after launch completion to refresh building state

---

## 4. Launch Success/Failure Formulas

### 4.1 Launch Duration

```
baseTime = 128 hours / (1 + productionModifier / 100)
effectiveTime = baseTime / 2^(level - 1)
```

- Base launch time: 128 hours (460,800 seconds)
- Production modifier (from recreation bonus, executives, etc.) reduces time
- Each Launch Pad level above 1 **halves** the remaining time
- Displayed as hours:minutes

Source: `chunk_Xoi.js`, `infoTimeToLaunch()` method.

### 4.2 Rocket Explosion (RUD) Probability

```
failureProbability = 0.5 / 2^quality
```

| Rocket Quality | Explosion Chance |
|---------------|-----------------|
| Q0 | 50.000% |
| Q1 | 25.000% |
| Q2 | 12.500% |
| Q3 | 6.250% |
| Q4 | 3.125% |
| Qn | 0.5 / 2^n |

Source: `chunk_Xoi.js`, `infoIncident()` method.

### 4.3 Failure Consequences

- Rocket explosion is recorded as "Rocket explosion on the launchpad" (transaction type: `ROCKET_EXPLOSION`, code `1-explosion`)
- Cost of rocket launch failures is reflected in **COGS** on the Income Statement
- Certificate exists for "most rapid unscheduled disassemblies (RUDs) in a month" (the "Elon Award")

### 4.4 Launch Success Rewards

- On successful launch, the consumed Aerospace Research produces **patents**
- Patents increase company **Patent Value** (visible on public profile)
- Each patent type has a fixed value
- Patents from Aerospace Research were adjusted to be valued ~7% less than retail value to balance launch vs. retail strategies
- Aerospace Research is always Q0 (quality on ASR was a bug, retroactively fixed)

---

## 5. Research & Patent System

### 5.1 Patent Conversion

Research points (including Aerospace Research) can be applied to a resource to improve its researched quality. Each application:

- Has a **6.25%** probability to yield patents (was 12.5% before CTO rebalance)
- CTO executives can increase the number of patents yielded per conversion
- CTOs also impact production speed of research points

### 5.2 Quality Research Mechanics

- Each quality level of research improves production speed of the associated resources by a `bonusPerQuality` percentage
- Applying research beyond the quality cap wastes research points without yielding patents
- **Research quality cap**: 12 or realm-specific cap (whatever is hit first)
- Quality on Aerospace Research itself is always Q0 (cannot have quality)

### 5.3 Patent Value

- Patents have a fixed value per patent type
- Patent Value is a component of overall company worth on the balance sheet
- Displayed on public company profile
- `MoneyTransaction.patentConversion` tracks value lost/gained when converting research to patents

### 5.4 Certificates Related to Aerospace

| Certificate | Condition |
|-------------|-----------|
| Highest Patents | Highest patents value in a month |
| Elon Award | Most RUDs (rocket explosions) in a month |
| Rocket Blown | Accumulated RUD count display |

---

## 6. Aerospace Contract System

### 6.1 Overview

Aerospace products are sold through the **Sales Office** building using a **contract/order** system. Works like standard sales offices but deals specifically in aerospace products.

### 6.2 Contract Mechanics

1. **Contract Search**: Player pays a `searchCost` to find contracts (transaction type: `SALES_ORDER_SEARCH`, code `1-sosearch`). Displayed as "Looking for aerospace contracts" in money transactions.

2. **Contract Details**: Each sales order contains:
   - `id`: Unique contract identifier
   - `resources`: Array of `{amount, kind}` — the products to deliver
   - `searchCost`: Cost to find this contract
   - `datetime`: When the contract was generated

3. **Contract Fulfillment**: Player delivers the required resources from inventory. Fulfilled contracts pay:
   - Revenue = sum of resource retail value
   - Profit = Revenue - COGS - searchCost
   - Transaction type: `SALES_ORDER_FULFILLED` (code `1-sofull`)

4. **Contract Expiration**: Contracts expire after **47 hours** (`Rle = 60 * 60 * 47` = 169,200 seconds). Source: `chunk_zjr.js`.

5. **Resource Selection**: When fulfilling, rockets are selected from inventory by highest quality first (configurable to lowest quality first).

### 6.3 Contract Distribution

Contract product distribution is adjusted based on current market demand. The goal is to balance BFR presence with actual demand conditions. (Reference: May 20 changelog entry)

### 6.4 Aerospace Sales Chat

A dedicated chat room exists for aerospace sales ("Aerospace Sales" — `Chat.aerospaceSales`). Requires level 5 for sales chat posts in the Entrepreneurs realm.

---

## 7. Launch Pad Building Mechanics

### 7.1 Building Stats

| Property | Value |
|----------|-------|
| dbLetter | `l` |
| Category | Research |
| sincePhase | 7 |
| Cost Units | 36 |
| Build Duration | 32,400 seconds (9 hours) |
| Salary Modifier | 1.5x |
| Max Level | 8 (limited for new constructions) |
| Landscape Images | launchpad-lvl1/2/3.png |

### 7.2 Level Effects

- Each level halves launch time (base: 128 hours at level 1)
- BFR launch requires level >= 3
- Launch costs are capped at level 8 (levels > 8 use level 8 costs)
- Upgrade button hidden for level 8 launch pads

### 7.3 Building Queue Behavior

- Launch Pad has a production queue for rocket launches
- Queue is fetched/refreshed when building is selected or busy state changes
- When building becomes busy with Aerospace Research production, the queue is refreshed
- After launch completion, building refreshes after 1-second delay

### 7.4 Related Aerospace Buildings

| sn Key | dbLetter | Name | Category | Cost Units | Build Duration (s) | Salary Mod |
|--------|----------|------|----------|------------|---------------------|------------|
| 0 | 0 | Hangar | Production | 29 | 10,800 | 2.2x |
| 7 | 7 | Aerospace Factory | Production | 31 | 21,600 | 1.7x |
| 8 | 8 | Aerospace Electronics | Production | 41 | 21,600 | 2.1x |
| 9 | 9 | Vertical Integration Facility | Production | 33 | 10,800 | 2.2x |
| D | D | Propulsion Factory | Production | 30 | 25,200 | 1.8x |
| l | l | Launch Pad | Research | 36 | 32,400 | 1.5x |

### 7.5 Building Level Images

All aerospace production buildings have tiered level images at levels: 1, 2, 3, 6, 10, 15.

---

## 8. Key Constants Summary

| Constant | Value | Description |
|----------|-------|-------------|
| `k0[0]` | 400 | Sub-Orbital Rocket launch cost (Aerospace Research units) |
| `k0[1]` | 2,800 | BFR launch cost (Aerospace Research units) |
| `Rle` | 169,200 s (47h) | Contract expiration window |
| `LAUNCH_QUEUE_MAX` | 30 | Maximum queued launches per Launch Pad |
| Base Launch Time | 128 h | At level 1, 0% production modifier |
| Base RUD Probability | 50% | At Q0; halves per quality level |
| Patent Conversion Rate | 6.25% | Probability per research application |
| Research Quality Cap | 12 | Or realm-specific cap |

---

*Data extracted from decompiled Sim Companies JavaScript modules. Phase 7 content (aerospace expansion).*
