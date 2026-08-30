# Production Formulas — Sim Companies

All formulas extracted from decompiled JS modules. Source file:line annotations in `[file:line]` format.
Base path: `decompiled/modules/`

---

## 1. Core Constants

| Constant | Value | Source |
|---|---|---|
| `AVERAGE_SALARY` | 345 | `chunk_oX.js:4847` |
| `SALARY_MID` | `{0: 655, 1: 700, 2: 745}` | `chunk_oX.js:4850-4854` |
| `ROBOT_COST` | 940 | `chunk_oX.js:4855` |
| `lsr` (robot salary bonus per robot) | 4 | `entry.js:4742` |
| `hb` (CTO research bonus per level) | 2 | `entry.js:4672` |
| `G9` (season threshold) | 0.8 | `entry.js:4729` |
| `PRODUCTION_SPEED_MODIFIER_DAYS` | 21 | `chunk_oX.js:4956` |
| `PRODUCTION_SPEED_MODIFIER_RESOURCES` | 3 | `chunk_oX.js:4957` |
| `PRODUCTION_SPEED_MODIFIER_FIRST_DAY` | 0 | `chunk_oX.js:4958` |
| `MIN_WEATHER_SPEED_MULTIPLIER` | 0.3 | `chunk_oX.js:4994` (kpr) |
| `MAX_WEATHER_SPEED_MULTIPLIER` | 1.7 | `chunk_oX.js:4995` (Ppr) |
| `LAUNCH_QUEUE_MAX` | 30 | `chunk_oX.js:4959` |
| `TUTORIAL_BONUS` | 12000 | `chunk_oX.js:4960` |
| `RETAIL_MODELING_QUALITY_WEIGHT` | 0.3 | `chunk_oX.js:4961` |

---

## 2. Base Production Rate (Per-Hour, Per-Building-Level)

### 2.1 B6t — Base Production Adjusted for Salary

**File:** `chunk_kle.js:29-31`

```
B6t(producedPerHourRaw, salaryMid, buildingType) =
    producedPerHourRaw * (AVERAGE_SALARY / salaryMid) ^ sn[buildingType].salaryModifier
```

Where:
- `producedPerHourRaw` — raw hourly production from resource definition (`chunk_oX.js` entries starting ~line 1424)
- `salaryMid` — `SALARY_MID[salaryLevel]`, the salary midpoint for the current economic salary level (0/1/2)
- `buildingType` — the `producedAt` value (building dbLetter like "F", "R", "Y", etc.)
- `sn[buildingType].salaryModifier` — salary exponent per building type (see §8)

**Expanded:**
```
baseProduction = producedPerHourRaw * (345 / SALARY_MID[salaryLevel]) ^ salaryModifier
```

### 2.2 qx — Resource-AnHour Map for a Building

**File:** `chunk_lg_2.js:6-16`

```
For each resource i produced by building type t:
  anHour = i.producedPerHourRaw
         * (speedModifier / 100 + 1)
         * (AVERAGE_SALARY / SALARY_MID[salaryLevel]) ^ t.salaryModifier
```

`speedModifier` comes from active `resourceProductionModifiers[speedModifier]`.

---

## 3. Production Speed — The $6t Core Formula

**File:** `entry.js:18574-18578`

```
$6t(dbLetter, salaryPercent, unused, quality, size, baseProduction, productionModifierObj) =
    size * adjustedBase / (1 - salaryPercent / 100)

where:
    adjustedBase = (isMining(dbLetter) ? baseProduction * quality / 100 : baseProduction)
                 * ((productionModifierObj?.speedModifier ?? 0) / 100 + 1)
```

### Mining Resources (quality affects production)

**File:** `chunk_oP.js:43-54`

The `px()` function identifies mining resources that get quality-adjusted production:
- Crude Oil, Minerals, Bauxite, Iron Ore, Sand, Gold Ore, Methane, Clay, Limestone

For these, `baseProduction *= quality / 100`.

For all other resources, quality does NOT affect production (only sale price).

### Robot Effect on Production

**File:** `chunk_Unn.js:213`

Robot count adds to the effective salary percentage:

```
effectiveSalary = salaryPercent + lsr * robotCount   // lsr = 4
```

Only for **accumulator-type** buildings (`productionMechanic.type === "accumulator"`). For non-accumulator buildings, robots have no effect on production speed.

So for accumulator buildings:
```
producedPerHour = size * adjustedBase / (1 - (salaryPercent + 4 * robots) / 100)
```

---

## 4. Production Bonuses (Additional Speed Multipliers)

**File:** `chunk_Pli.js:931-934`

```
totalBonus = productionModifier + recreationBonus + accumulatorQualityBonus

producedPerHourWithBonuses = anHour / (1 - totalBonus / 100)
```

Where:
| Bonus | Source |
|---|---|
| `productionModifier` | Company-wide production speed modifier (from auth) |
| `recreationBonus` | Sum of sizes of recreation buildings with active upkeep (see §9) |
| `accumulatorQualityBonus` | `bonusPerQuality * researchedQuality` for accumulator resources only |

---

## 5. Accumulator Resource Mechanics

**File:** `chunk_Inn_2.js:1-3` (sve function), `chunk_oX.js:4524-4531` (definition)

### sve — Accumulator Value

```
sve(baseValue, quality) = baseValue * 2 ^ quality
```

### Accumulator Parameters (Xmas Tree example, `chunk_oX.js:4524-4531`):

```
productionMechanic: {
    type: "accumulator",
    accumulatorParameters: {
        baseValue: 10,       // base accumulator value at quality 0
        max: 81910,          // maximum accumulator value
        amountPerLevel: 1,  // increment per quality level (for display)
        bonusPerQuality: 4   // production speed bonus per quality (%)
    }
}
```

### Accumulator Quality Calculation

**File:** `entry.js:21685-21707`

```
For quality levels u = 0..maxQuality:
    accumulatorValue = baseValue * 2 ^ u
    If current accumulator value < accumulatorValue:
        effectiveQuality = u - 1
        break
```

The quality level of the building is derived from the accumulated production amount.

---

## 6. Production Time Calculation

### 6.1 Per-Unit Time

**File:** `chunk_Unn.js:237`

```
timeToProduce(amount) = ZU(buildingType) / (producedPerHour * amount / size) * eventMultiplier
```

Where:
- `ZU(buildingType)` = `345 * sn[buildingType].salaryModifier` (from `entry.js:18564-18565`)
- `eventMultiplier` = 0.97 if event flag `E` is set, otherwise 1

**Simplified for 1 unit with building already producing:**

```
timePerUnit = 345 * buildingSalaryModifier * size / producedPerHour * eventMultiplier
```

Alternatively expressed as:

```
timePerUnit_seconds = (345 * salaryMod) / (producedPerHour / size)  [ignoring event]
                    = (345 * salaryMod * size) / producedPerHour
```

### 6.2 Time for Multiple Units (with COO skill)

**File:** `chunk_Unn.js:245-256`

```
timeForQueue(amount) = max(0, spareCapacity - 1) * timeToProduce(amount)

where:
  spareCapacity = COO-adjusted queue size (v)
  v = ph(adminOverhead, cooSkill)
  ph(t, e) = t - (t - 1) * e / 100   // chunk_BT.js:30-33
```

### 6.3 Building Busy End Time

**File:** `entry.js:56045-56052`

```
busyEndTimestamp = Date.parse(busy.started) + busy.duration * 1000
```

### 6.4 Building Construction Time

**File:** `chunk_wsi.js:119`

```
constructionFinished = now + size * sn[buildingType].buildDuration * 1000
```

---

## 7. Research Buildings

**File:** `chunk_Pin.js:288-294`, `chunk_Unn.js:214-215`

Research buildings use the same `$6t` formula but with an additional CTO multiplier:

```
researchProduction = $6t(...) * (100 + ctoSkill * hb) / 100
                                    // hb = 2% per CTO level
```

---

## 8. Building Salary Modifiers (sn[])

**File:** `entry.js:7728` et seq.

| Building | dbLetter | salaryModifier | buildDuration (s) |
|---|---|---|---|
| Plantation | P | 0.3 | 3600 |
| Well | W | 1.0 | 7200 |
| Power Plant | E | 1.2 | 10800 |
| Orchard | O | 1.5 | 14400 |
| Refinery | R | 1.4 | 14400 |
| Synth Plant | S | 0.9 | 10800 |
| Greenhouse | G | 0.4 | 3600 |
| Chemistry Lab | C | 0.5 | 3600 |
| Assembly Line | A | 1.0 | 7200 |
| Factory | F | 0.4 | 7200 |
| Mill | M | 0.8 | 14400 |
| Dairy Farm | D | 1.8 | 25200 |
| Brewery | B | 1.7 | 7200 |
| Confectionery | Q | 0.8 | 10800 |
| Fashion Factory | o | 1.1 | 18000 |
| Electronics Factory | x | 1.4 | 21600 |
| Aerospace Factory | g | 1.0 | 7200 |
| Auto Factory | d | 0.5 | 14400 |
| Nuclear Power Plant | n | 0.0 | 28800 |
| Water Reservoir | 0 | 2.2 | 10800 |
| Wind Turbine | 1 | 1.3 | 21600 |
| Solar Panel | 2 | 1.1 | 10800 |
| Hydro Power Plant | 3 | 0.0 | 43200 |
| Geothermal Plant | 4 | 0.0 | 43200 |
| Coal Power Plant | 5 | 0.0 | 43200 |
| Warehouse | 6 | 0.7 | 7200 |
| Oil Rig | 7 | 1.7 | 21600 |
| Mine | 8 | 2.1 | 21600 |
| Quarry | 9 | 2.2 | 10800 |
| Launch Pad | L | 1.1 | 18000 |
| Ranch | Y | 1.2 | 10800 |
| Zoo | e | 1.2 | 14400 |
| Vertical Farm | i | 1.1 | 10800 |
| Sawmill | j | 1.3 | 18000 |
| Juicery | k | 1.1 | 21600 |
| Steel Mill | m | 1.9 | 14400 |
| Space Station | r | 1.7 | 10800 |
| Retail Store | t | 0.6 | 7200 |
| Supermarket | u | 0.7 | 7200 |
| Grain Silo | v | 0.23 | 7200 |
| Oil Tank | y | 0.0 | 28800 |
| Gas Tank | z | 0.7 | 7200 |
| Restaurant | I | 0.7 | 3600 |
| Sales Office | T | 0.4 | 7200 |
| Hangar | H | 0.9 | 10800 |
| Art Studio | p | 1.3 | 18000 |
| News Studio | h | 1.7 | 25200 |
| Book Publisher | b | 1.2 | 18000 |
| Game Studio | c | 1.2 | 18000 |
| Movie Studio | s | 1.7 | 10800 |
| Recording Studio | a | 1.6 | 21600 |
| Airport | f | 1.3 | 7200 |
| Tech Lab | l | 1.5 | 32400 |
| Archeology Site | q | 1.5 | 14400 |

---

## 9. Recreation Bonus

**File:** `chunk_oX.js:836`

```
U3(buildings) = sum of sizes of all recreation-category buildings
                that have active upkeep and are NOT on position "plaza-"
```

This sum feeds into `recreationBonus` in the production bonus formula (§4).

---

## 10. Season Effects on Production

### 10.1 Production Season Yield Check

**File:** `chunk_U6t.js:31-58`

```
n9r(resource, date):
    If no productionSeason: return true
    Get season = n3t[resource.productionSeason]
    Find surrounding yield points (min/max) for current date
    Linearly interpolate between points:
        progress = daysSince(pointA) / daysBetween(pointA, pointB)
        currentMax = (maxB - minA) * progress + minA
    Return currentMax > 0.8  (= G9 threshold)
```

### 10.2 Production Season Yield Range (Display)

**File:** `chunk_Unn.js:258-263`

When a resource has a `productionSeason`, the UI shows a yield range of **[0.03, 1.4]**.

### 10.3 Retail Season Saturation Check

**File:** `chunk_U6t.js:2-29`

Similar interpolation formula but for `saturation` values:

```
U6t(resource, date):
    If no retailSeason: return true
    Interpolate saturation between date points
    Return interpolatedSaturation > 0.8  (= G9)
```

### 10.4 Season Definitions

**Source:** `chunk_oX.js:4701-4845`

Seasons with `saturation` (retail):
- **Summer**: Jul 14–Aug 20 (peak 1.0)
- **Halloween**: Oct 15–Nov 3 (peak 1.0)
- **Xmas**: Nov 25–Dec 24 (peak 1.0)
- **Ramadan**: Feb 18–Mar 19 (peak 1.0)
- **Easter**: Mar 20–Apr 20 (peak 1.0)

Seasons with `productionYield` (production, min/max pairs):
- **AutumnHarvest**: Sep 3–Nov 14 (max yield 1.0–1.5)

---

## 11. Robot Count Calculator

**File:** `chunk_lg_2.js:22-25`

```
J9(building) =
    let raw = building.salaryModifier * (345 * 24 * 7 * 5 * 0.03) / 940
    //        = building.salaryModifier * 8694 / 940
    //        ≈ building.salaryModifier * 9.249
    return max(1, ceil(raw + (raw - 4.5) * 1.2))
```

### Robot Salary Cost

**File:** `chunk_lg_2.js:3-5`

```
lg(building) = 345 * building.salaryModifier
```

### Robot Reference Cost

**File:** `chunk_lg_2.js:26-28`

```
J0(costUnits) = costUnits * 10 * 345
```

---

## 12. Administration Overhead with COO

**File:** `chunk_BT.js:30-33`

```
ph(adminOverhead, cooSkill) = adminOverhead - (adminOverhead - 1) * cooSkill / 100
```

The COO executive reduces the administration overhead multiplier.

---

## 13. Research (CTO) Effect

**File:** `chunk_Pin.js:288-294`, `chunk_Unn.js:167-171`

```
researchBonus = ctoSkill * hb   // hb = 2% per level
production = $6t(...) * (100 + researchBonus) / 100
```

---

## 14. Complete Production Chain Summary

```
1. Base Rate:
   baseRate = B6t(producedPerHourRaw, SALARY_MID[salaryLevel], buildingType)

2. Quality Adjustment (mining only):
   IF isMining: baseRate *= quality / 100

3. Speed Modifier:
   baseRate *= (speedModifier / 100 + 1)

4. Salary Denominator:
   effectiveSalary = salaryPercent + (isAccumulator ? 4 * robots : 0)
   producedPerHour = size * baseRate / (1 - effectiveSalary / 100)

5. Bonus Multiplier:
   totalBonus = productionModifier + recreationBonus + accumulatorQualityBonus
   finalProducedPerHour = producedPerHour / (1 - totalBonus / 100) [Pli variant]
   OR alternatively applied through the salary denominator [Unn variant]

6. Research Buildings:
   finalRate *= (100 + ctoSkill * 2) / 100

7. Time to Produce:
   time_seconds = (345 * buildingSalaryModifier * size) / finalRate * eventMultiplier
```

**Note:** The `§4` bonus and `§3` salary denominator are applied slightly differently
in different UI contexts (`chunk_Pli.js` vs `chunk_Unn.js`). The Pli variant divides
`anHour` by `(1 - totalBonus/100)` where `anHour` already has salary baked into the
baseRate. The Unn variant passes bonuses through the salary parameter of `$6t`.
The game server ultimately computes the authoritative value.
