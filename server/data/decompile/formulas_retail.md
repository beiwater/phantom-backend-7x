# Retail Sales & Demand Formulas

> Extracted from decompiled Sim Companies JS modules. Source files cited inline.

## 1. Resource Retail Properties

**Source:** `chunk_oX.js`, `entry.js` (`gt` → `Xdr`)

Each resource has these retail-relevant fields:

| Field | Type | Description |
|-------|------|-------------|
| `transportation` | number | Transportation cost units per item sold on market |
| `unitsSoldAnHour` | number | Base units sold per hour at retail (0 = not retailable) |
| `retailSeason` | string\|null | Seasonal retail demand (null = always available) |
| `productionSeason` | string\|null | Seasonal production modifier |
| `consumption` | number | Economy model consumption weighting |
| `hasEconomyModel` | boolean | Whether economy modeling data exists |
| `decay` | number | Decay rate (0 = no decay, e.g., 0.05 for icecream) |

### Example retailable resources

```
Resource 3 (Apples):  transportation=1, unitsSoldAnHour=110, retailSeason=null
Resource 7 (Steak):   transportation=1, unitsSoldAnHour=35,  retailSeason=null
Resource 9 (Eggs):    transportation=0.1, unitsSoldAnHour=340, retailSeason=null
Resource 67 (Xmas Crackers): transportation=0.5, unitsSoldAnHour=400, retailSeason="Xmas"
Resource 144 (Xmas Sweater): transportation=1, unitsSoldAnHour=85,  retailSeason="Xmas"
Resource 147 (Halloween Candy): transportation=1, unitsSoldAnHour=24, retailSeason="Halloween"
Resource 148 (Halloween Mask):  transportation=1, unitsSoldAnHour=19, retailSeason="Halloween"
Resource 151 (Easter Egg):  transportation=0.3, unitsSoldAnHour=35, retailSeason="Easter"
Resource 152 (Ramadan Sweets): transportation=1, unitsSoldAnHour=40, retailSeason="Ramadan"
Resource 153 (Chocolate Icecream): transportation=1, unitsSoldAnHour=22, retailSeason="Summer", decay=0.05
Resource 154 (Apple Icecream): transportation=1, unitsSoldAnHour=18, retailSeason="Summer", decay=0.05
```

### Which buildings sell which resources

**Source:** `chunk_oX.js` (`Ji.SALES` → `dpr`)

Building dbLetters mapped to their sellable resource IDs:

| Building kind | Sells resource IDs |
|---|---|
| `2` (Car Dealership) | 53-57 |
| `G` (Grocery Store) | 3-5, 7-9, 119, 122-127, 140, 152 |
| `A` (Electronics Store) | 11, 12 |
| `C` (Fashion Store) | 24-28, 98 |
| `H` (Hardware Store) | 60-65, 70, 71 |
| `B` (Furniture Store) | 91, 94-97, 99 |
| `d` (Drug Store) | 102, 103, 108-110 |
| `r` (Restaurant) | 117, 119, 121-126, 129-132, 134, 142, 143, 149 |
| `t` (Halloween Shop) | 146-148 |
| `z` (Summer Shop — icecream) | 153, 154 |
| `I` (Easter Shop) | 151, 155 |
| `u` (Xmas Shop) | 67, 144, 150 |

---

## 2. Retail Season System

**Source:** `chunk_U6t.js`, `chunk_oX.js`

### Season Activity Check: `U6t(resource, date)`

```
function U6t(resource, date):
    if resource.retailSeason == null: return true   // always active
    season = r3t[resource.retailSeason]              // lookup season config
    // Find bracketing saturation points
    prev = saturation[0]
    next = saturation[last]
    for each point in saturation:
        if point.date <= date: prev = point
        if point.date > date:  next = point; break
    if prev == next:
        return prev.saturation > G9   // G9 = 0.8
    // Linear interpolation between prev and next
    elapsed = (date - prevDate) / (nextDate - prevDate)
    currentSaturation = elapsed * (next.saturation - prev.saturation) + prev.saturation
    return currentSaturation > 0.8
```

Key: `G9 = 0.8` — the season is considered "active" when saturation exceeds 80%.

### Season Saturation Data (`npr` → `r3t`)

**Source:** `chunk_oX.js:4792`

| Season | ID | Saturation Curve |
|--------|-----|------------------|
| **Ramadan** | `"Ramadan"` | 0.03 → (02-18) 0.9 → (03-19) 1.0 → (03-30) 0.03 |
| **Easter** | `"Easter"` | 0.03 → (03-20) 0.9 → (04-20) 1.0 → (04-30) 0.03 |
| **Summer** | `"Summer"` | 0.03 → (07-14) 1.0 → (08-20) 1.0 → (09-14) 0.03 |
| **Halloween** | `"Halloween"` | 0.03 → (10-15) 1.0 → (11-03) 1.0 → (11-15) 0.03 |
| **Xmas** | `"Xmas"` | 0.3 → (01-10) 0.03 → (11-25) 0.7 → (12-04) 1.0 → (12-24) 1.0 → (12-31) 0.3 |

- Saturation is linearly interpolated between date points
- A season is "active" when interpolated saturation > 0.8
- `Ple(resource, date)` dispatches to `U6t` (retail) or `n9r` (production)

### Season Resource Mapping

A run-time check (`Tle` in entry.js:18758-18762) evaluates `U6t(resource, new Date())` for every resource at startup. `HM` exports seasonally-active resource dbLetters sorted by activity.

---

## 3. Retail Sales Formula (Core)

**Source:** `chunk_kle.js`, `entry.js` (Q7r, Bme, r9r, t9r)

### Top-level function: `kle(buildingKind, economyModel, unitsSold, salesModifier, price, quality, saturation, acceleration, size, weather)`

Returns: **hours to sell `unitsSold` units**

```
kle(t, e, r, n, i, a, o, s, c, u):
    d = J7r(t, e, a, o, r, i)          // base time (seconds) from economic model
    if d <= 0: return NaN               // unprofitable → no sale
    
    p = d / s / c                        // adjust for acceleration and building size
    f = p * (1 - n / 100)               // apply sales modifier % (CMO skill + recreation)
    if u != null:
        f /= u.sellingSpeedMultiplier   // weather speed modifier (Summer only)
    return f                             // hours to sell `r` units
```

### Helper: `J7r(buildingKind, economyModel, quality, saturation, unitsSold, price)`

Returns: **base seconds to sell** (before acceleration/size/modifiers)

```
J7r(t, e, quality, saturation, unitsSold, price):
    // Step 1: Demand level from saturation
    d = clamp(2 - saturation, 0, 2)       // saturation 0→2, d=2→0 (inverted)
    demand = max(0.9, d/2 + 0.5)           // demand multiplier: 0.9–1.485
    // At saturation=0.03: d≈1.97, demand=1.485
    // At saturation=1.0:  d=1.0,  demand=1.0
    // At saturation=2.0:  d=0,    demand=0.9

    // Step 2: Quality factor
    qf = quality / 12

    // Step 3: Economy model scaling (g)
    isrFactor = isr[buildingKind] ?? 1     // isr: { B: 2.28 }
    g = Zor                                          // 370
      * (e.buildingLevelsNeededPerUnitPerHour 
         * e.modeledUnitsSoldAnHour + 1)
      * isrFactor
      * (d/2 * (1 + qf * RETAIL_MODELING_QUALITY_WEIGHT))  // 0.3

    // Step 4: Adjusted demand
    adjDemand = e.modeledUnitsSoldAnHour * demand

    // Step 5: Optimal price (e9r)
    optimalPrice = e.modeledProductionCostPerUnit
                 + (g + e.modeledStoreWages) / adjDemand

    // Step 6: Revenue elasticity (t9r) — quadratic penalty for price deviation
    alpha = (e.modeledStoreWages + g) / (optimalPrice - e.modeledProductionCostPerUnit)^2
    adjRevenue = g - (price - optimalPrice)^2 * alpha

    // Step 7: Time to sell (r9r)
    return (unitsSold * (price - e.modeledProductionCostPerUnit) * 3600 - e.modeledStoreWages)
         / (adjRevenue + e.modeledStoreWages)
```

### Helper functions

**`e9r`** — optimal price calculation:
```
e9r(g, productionCostPerUnit, unitsPerHour, storeWages):
    return productionCostPerUnit + (g + storeWages) / unitsPerHour
```

**`t9r`** — revenue elasticity (quadratic penalty):
```
t9r(g, optimalPrice, actualPrice, storeWages, productionCostPerUnit):
    alpha = (storeWages + g) / (optimalPrice - productionCostPerUnit)^2
    return g - (actualPrice - optimalPrice)^2 * alpha
```
If actual price deviates from optimal, adjusted revenue decreases quadratically.

**`r9r`** — time to sell:
```
r9r(adjRevenue, productionCostPerUnit, storeWages, price, unitsSold):
    return (unitsSold * (price - productionCostPerUnit) * 3600 - storeWages)
         / (adjRevenue + storeWages)
```

---

## 4. Constants

**Source:** `chunk_oX.js`, `entry.js`

| Constant | Value | Meaning |
|----------|-------|---------|
| `Zor` | `370` | Economy model base scaling factor |
| `G9` | `0.8` | Season activity threshold (saturation > 0.8 = active) |
| `Ji.AVERAGE_SALARY` (`opr`) | `345` | Base salary for wage calculations |
| `Ji.RETAIL_MODELING_QUALITY_WEIGHT` (`ypr`) | `0.3` | How much quality affects economy model |
| `Ji.MIN_WEATHER_SPEED_MULTIPLIER` (`kpr`) | `0.3` | Minimum weather speed multiplier |
| `Ji.MAX_WEATHER_SPEED_MULTIPLIER` (`Ppr`) | `1.7` | Maximum weather speed multiplier |
| `isr` | `{ B: 2.28 }` | Building-type economy model modifier (only "B" defined) |

### Economy Model Data (`PKe` → `vin`)

**Source:** `chunk_Unn.js:678-682`

Per resource, per economy state, the economy model provides:
- `buildingLevelsNeededPerUnitPerHour` — how many building levels needed per unit/hour
- `modeledProductionCostPerUnit` — estimated production cost per unit
- `modeledStoreWages` — estimated store wages (null for non-retail)
- `modeledUnitsSoldAnHour` — modeled demand per hour

`gk(economyState, dbLetter, quality)` fetches these per quality level.

---

## 5. Profit Calculation

**Source:** `chunk_roi.js:1153-1171`

```
calculateProfitForQuantity(quantity):
    salesModTotal = salesModifier + recreationBonus + floor(skillCMO / 3)
    adminOverhead = ph(administrationOverhead, skillCOO)
    
    tts = kle(buildingKind, economyModel, quantity, 
              salesModTotal, price, quality, 
              saturation, acceleration, size, weather)
    
    revenue = price * quantity
    wagesTotal = ceil(tts * wages * acceleration * adminOverhead / 3600)
    profit = revenue - wagesTotal - cogs
    
    return { tts, revenue, wagesTotal, profit }
```

### Administration Overhead (`ph`)

**Source:** `chunk_BT.js:30`

```
ph(administrationOverhead, skillCOO):
    overhead = administrationOverhead || 1
    return overhead - (overhead - 1) * skillCOO / 100
```
COO skill reduces admin overhead linearly. At skillCOO=100, overhead reaches 1.0 (no penalty).

### Sales Modifier Components

```
salesModifierWithRecreationBonus = (salesModifier ?? 0) + (recreationBonus || 0)
effectiveSalesMod = salesModifierWithRecreationBonus + floor(skillCMO / 3)
```

- `salesModifier`: Company-wide modifier from buildings/research
- `recreationBonus`: From recreation buildings
- `skillCMO / 3`: CMO executive skill contributes floor(skill/3) percentage points

---

## 6. Sales Orders (Aerospace Contracts)

**Source:** `chunk_Fci.js`, `chunk_usi.js`

Sales Office buildings generate and fulfill sales orders (contracts):

### Order Structure
```json
{
    "id": number,
    "datetime": "ISO date",
    "resources": [
        { "kind": dbLetter, "amount": number, "price": number }
    ],
    "qualityBonus": number   // percentage bonus for quality
}
```

### Revenue Calculation

**Source:** `chunk_usi.js:241-253`

```
revenue = sum over resources:
    price * amount * quality * qualityBonus / 100
```

- Quality is the minimum quality of stock used to fulfill
- `qualityBonus` is a percentage on the order (e.g., 100 = 100% bonus → double revenue at quality=1)
- Orders expire after `Rle` seconds (server-controlled)

### Fulfillment

1. Player selects stock to allocate to each resource requirement
2. Stock sorted by quality (highest or lowest first, toggleable)
3. `fulfillSalesOrder(orderId, resources, lowestQualityFirst)` API call
4. Resources consumed, money added

### Contract Search

Building must be unbusy and have available slots (`size - currentOrders > 0`). Search costs:
```
cost = floor(lg(building) * ph(adminOverhead, skillCOO) * 47 
       * (100 - effectiveSalesMod) / 100)
```

---

## 7. Transportation Cost

**Source:** `chunk_sBr.js`, resource data in `chunk_oX.js`

Each resource has a per-unit `transportation` value. When placing market orders:

```
transportationUnitsNeeded = ceil(amount * transportation)
```

- Applied to both buy and sell market orders
- For contract orders (direct sales): `ceil(amount * transportation / 2)`
- Transportation resource (resource ID = me.TRANSPORTATION) is consumed from inventory
- If insufficient transportation available, order cannot be placed

### Example transportation values

| Resource | Transportation |
|----------|---------------|
| Power (1) | 0 |
| Apples (3) | 1 |
| Grain (6) | 0.1 |
| Eggs (9) | 0.1 |
| Gold Ore (68) | 10 |

---

## 8. Weather (Summer Speed Multiplier)

**Source:** `chunk_yin.js`, `chunk_oX.js`

When a resource has `retailSeason === "Summer"` (resources 153, 154 — icecream):
- Weather object with `sellingSpeedMultiplier` is passed to `kle`
- The multiplier ranges from `0.3` (slow) to `1.7` (fast)
- In `kle`: `f /= multiplier` — higher multiplier = faster selling (fewer hours)
- Weather object is server-provided per realm

---

## 9. Display Case

**Source:** `chunk__ii.js`, `chunk_FOr.js`, `chunk_MRn.js`

Display cases are cosmetic slots on player profiles for certificates/NFTs.

- **Slots:** `authCompany.displayCaseSlots` — number of available slots (server-side)
- **Additional slots:** Purchased with SimBoosts via `Wo.DISPLAY_CASE` purchase driver
- **Slot cost:** `$i().displayCaseSlotCost` — dynamic, server-provided
- **Max slots:** `sRt` — server-defined maximum
- **API:** `GET /api/v2/companies/display-case/:id` returns display case contents

### Unlock Flow
1. Check: `displayCase.length >= displayCaseSlots` → all slots filled
2. Check: `displayCaseSlots < sRt` → can still buy more
3. Purchase: SimBoost cost determined server-side
4. Slot added: `displayCaseSlots + 1` on server response

---

## 10. Economy Model Lookup

**Source:** `chunk_Unn.js:684`

```
gk(economyState, dbLetter, quality):
    if quality == null:
        return PKe[economyState][dbLetter]   // base model
    return PKe[economyState][dbLetter].quality[quality]  // quality-adjusted
```

Economy model data (`vin` → `PKe`) is a large JSON structure indexed by economy state (0-2), then by resource dbLetter, containing:

- `buildingLevelsNeededPerUnitPerHour`
- `modeledProductionCostPerUnit`
- `modeledStoreWages`
- `modeledUnitsSoldAnHour`
- `quality`: quality-specific sub-models

Economy states: 0, 1, 2 (different economic conditions per realm phase).

---

## Summary: Retail Sales Flow

```
Player sets price & quantity →
  1. Economy model lookup: gk(economyState, dbLetter, quality)
  2. Season check: Ple(resource, date) → is resource in season?
  3. Demand calculation: modeledUnitsSoldAnHour * demandMultiplier(saturation)
  4. Price elasticity: optimal price = cost + overhead/volume
  5. Revenue penalty: quadratic deviation from optimal price
  6. Time to sell: (units * (price-cost) * 3600 - wages) / (adjRevenue + wages)
  7. Apply modifiers: salesModifier%, acceleration, building size, weather
  8. Profit: revenue - wages - cogs
```
