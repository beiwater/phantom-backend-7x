# Administration Overhead & Money Formulas

Extracted from decompiled Sim Companies JS modules.

---

## 1. Building Points (`i`)

**File:** `chunk_Lye.js:5-7`

```js
export function Ukn(t) {
    return Object.values(t).filter(Lye).reduce((e, r)=>e + r.size * 100, 0);
}
```

**Filter `Lye`** (`chunk_Lye.js:2-4`):
```js
export function Lye(t) {
    return !t.freeAndLocked && !v$.includes(t.kind);
}
```

**Excluded building kinds `v$`** (`entry.js:3949-3954`):
```js
export const v$ = ["n", "4", "5", "3"];
```
These are Headquarters (HQ level 1–4). They have `salaryModifier: 0` and are excluded from admin overhead.

**Formula:**
```
i = Σ building.size × 100    (for all non-HQ, non-free/locked buildings)
```

---

## 2. Administration Overhead Multiplier

**File:** `chunk_FOr.js:441-451`

```js
export const ky = (t = false)=>(e, r)=>{
    var n;
    if (!(r().user.fetchingAdministrationOverhead || !t && (n = r().user.administrationOverhead) != null && n)) {
        eo(e, F().api_v2_companies_administration_overhead(), YIt, ZIt, ({ data })=>{
            e({
                type: vme,
                payload: data
            });
        });
    }
};
```

- Fetched from server: `GET api_v2_companies_administration_overhead()`
- Server computes the overhead value; client stores and displays it
- Stored as a **multiplier** (e.g., `1.05` = 5% overhead)
- Cached in Redux store at `user.administrationOverhead`
- `force=true` bypasses cache

---

## 3. Administration Overhead + 1 (Next Admin)

**File:** `chunk_FOr.js:452-462`

```js
export const FM = (t)=>(e, r)=>{
    var n;
    if (!(r().user.fetchingAdministrationOverheadPlusOne || !t && (n = r().user.administrationOverheadPlusOne) != null && n)) {
        eo(e, F().api_v2_companies_administration_overhead_plus_one(), KIt, XIt, ({ data })=>{
            e({
                type: yme,
                payload: data
            });
        });
    }
};
```

- Fetched from server: `GET api_v2_companies_administration_overhead_plus_one()`
- Returns what the overhead multiplier would be with **one more admin (executive)**
- Cached at `user.administrationOverheadPlusOne`

---

## 4. Marginal Admin Cost — `moreAdmins()`

**File:** `chunk_Fci.js:1778-1785`

```js
this.moreAdmins = ()=>{
    const { administrationOverhead, administrationOverheadPlusOne, buildings } = this.props;
    const i = Ukn(buildings ?? {});
    if (administrationOverhead !== undefined && administrationOverheadPlusOne !== undefined) {
        return (administrationOverheadPlusOne - 1) * (i + 100) - (administrationOverhead - 1) * i;
    }
    return 0;
};
```

**Formula:**
```
moreAdmins = (AO_plusOne − 1) × (i + 100) − (AO_current − 1) × i
```
Where `i = Ukn(buildings)` = total building points.

This computes the marginal increase in total overhead cost from adding one admin. Result is in **salary units** (i.e., units of `Ji.AVERAGE_SALARY = 345`).

---

## 5. Effective Overhead with COO Skill — `ph()`

**File:** `chunk_BT.js:30-33`

```js
export const ph = (t, e)=>{
    const r = t || 1;
    return r - (r - 1) * e / 100;
};
```

**Formula:**
```
effectiveOverhead = AO − (AO − 1) × skillCOO / 100
```

- `t` = administration overhead multiplier (e.g., `1.10`)
- `e` = effective COO skill (after soft-capping, see §6)
- COO skill directly reduces overhead linearly: at 100 skill, overhead is eliminated entirely

**Example:** AO=1.10 (10% overhead), COO skill=40:
```
effective = 1.10 − (0.10) × 40/100 = 1.10 − 0.04 = 1.06  (6% overhead)
```

---

## 6. Executive Skill Calculation

### 6a. Raw skill sum — `BT()`

**File:** `chunk_BT.js:3-8`

```js
export const BT = (t, e)=>Math.floor(t.map((r)=>{
    if (r.skills) {
        return r.currentWorkHistory.position === o5t[e]
            ? r.skills[e]           // matching position: full skill
            : e === "coo" && r.currentWorkHistory.position === zt.COO_APPRENTICE
              || e === "cfo" && ... || e === "cmo" && ... || e === "cto" && ...
                ? r.skills[e] / 2   // apprentice in role: half skill
                : xM(r.currentWorkHistory.position)
                    ? r.skills[e] / 4  // other executive: quarter skill
                    : 0;
    }
    return 0;
}).reduce((r, n)=>r + n, 0));
```

Skill contribution by position match:
| Position vs Role | Multiplier |
|---|---|
| Exact match (e.g., COO → coo) | ×1.0 |
| Apprentice in same role (e.g., COO Apprentice → coo) | ×0.5 |
| Any other executive position | ×0.25 |
| Non-executive | ×0 |

### 6b. Soft cap — `s5t()`

**File:** `chunk_s5t.js:2-8`

```js
export function s5t(t) {
    let e = t;
    if (e > UK) {       // UK = 80
        e = UK + (e - UK) / 2;
    }
    if (e > E0) {       // E0 = 60
        e = E0 + (e - E0) / 2;
    }
    return e;
}
```

**Formula (piecewise):**
```
s5t(x) = x                              for x ≤ 60
        60 + (x − 60)/2                 for 60 < x ≤ 80
        80 + (x − 80)/2                 for x > 80
         = 60 + (x − 60)/2              for 60 < x ≤ 80
         = 70 + (x − 80)/2              for x > 80
```

Constants from `entry.js:3990-3991`:
- `UK = 80`
- `E0 = 60`

### 6c. Combined — `Ms()`

**File:** `chunk_BT.js:9`

```js
export const Ms = (t, e)=>Math.floor(s5t(BT(t, e)));
```

```
effectiveSkill = floor(s5t( Σ exec_skill_contributions ))
```

---

## 7. Wages — `lg()`

**File:** `chunk_lg_2.js:3-5`

```js
export function lg(t) {
    return Ji.AVERAGE_SALARY * t.salaryModifier;
}
```

- `Ji.AVERAGE_SALARY = 345` (base salary, `chunk_oX.js:4847`)
- `t.salaryModifier` varies by building type (see salary table below)

**Wage per building per "tick":**
```
wages = 345 × building.salaryModifier × building.size
```

### Salary Modifiers by Building Type

| Kind | Name | salaryModifier |
|------|------|---------------:|
| P | Plantation | 0.30 |
| W | Water Reservoir | 1.00 |
| E | Electric Plant | 1.20 |
| O | Oil Rig | 1.50 |
| R | Refinery | 1.40 |
| S | Saw Mill | 0.90 |
| G | Gold Mine | 0.40 |
| C | Copper Mine | 0.50 |
| A | Aluminum Mine | 1.00 |
| F | Flour Mill | 0.40 |
| M | Mine | 0.80 |
| Y | Yarn Mill | 1.20 |
| L | Lumber Mill | 1.10 |
| T | Truck Dealership | 0.40 |
| H | Car Dealership | 0.90 |
| p | Plastic Factory | 1.30 |
| h | Hardware Store | 1.70 |
| b | Brewery | 1.20 |
| c | Car Factory | 1.20 |
| s | Sugar Refinery | 1.70 |
| a | Assembly Line | 1.60 |
| f | Fashion Factory | 1.30 |
| l | Logging Camp | 1.50 |
| q | Quarry | 1.50 |
| D | Dairy Farm | 1.80 |
| B | Bakery | 1.70 |
| Q | Quality Control | 0.80 |
| o | Oil Power | 1.10 |
| x | Oil Distillery | 1.40 |
| g | Gas Station | 1.00 |
| d | Data Center | 0.50 |
| n | Headquarters | 0.00 |
| e | Electronics Factory | 1.20 |
| i | Iron Mine | 1.10 |
| j | Jewelry Factory | 1.30 |
| k | Kitchen Factory | 1.10 |
| m | Meat Factory | 1.90 |
| r | Restaurant | 1.70 |
| t | Toy Factory | 0.60 |
| u | Used Car Dealer | 0.70 |
| v | Vegetable Farm | 0.23 |
| y | Beverage Factory | 0.00 |
| z | Zoo | 0.70 |
| I | Ice Cream | 0.70 |
| 0 | Restaurant (luxury?) | 2.20 |
| 1 | (special) | 1.30 |
| 2 | (special) | 1.10 |
| 3 | HQ2 | 0.00 |
| 4 | HQ3 | 0.00 |
| 5 | HQ4 | 0.00 |
| 6 | (special) | 0.70 |
| 7 | (special) | 1.70 |
| 8 | (special) | 2.10 |
| 9 | (special) | 2.20 |

---

## 8. Admin Count Limit — `ade()`

**File:** `chunk_Lye.js:8-10`

```js
export function ade(t) {
    return Math.min(Math.floor(t / 4), K0);
}
```

- `K0 = 12` (`entry.js:4600`)
- **Formula:** `maxAdmins = min(floor(buildingPoints / 4), 12)`
- 1 admin per 400 building points, capped at 12

---

## 9. Overhead Cost Display

**File:** `chunk_Fci.js:1196-1205`

### Per-building overhead cost:
```
cost = building.size × 100 × (administrationOverhead − 1)
```

With default COO (3% reduction at skill=0?):
Actually, the `b` variable at line 1199-1206 appears to be a COO savings display:
```
savings = building.size × 100 × (administrationOverhead − 1) × 0.03
```
This shows the 3% savings from having a COO.

### Per-building total admin cost with COO:
```
effectiveCost = building.size × 100 × (administrationOverhead − 1) × (1 − skillCOO/100)
               = building.size × 100 × ph(administrationOverhead, skillCOO)
```

---

## 10. Production/Sales Modifier Update — `e5r()`

**File:** `chunk_FOr.js:380-386`

```js
export const e5r = (productionModifier, salesModifier)=>(r)=>r({
    type: HIt,
    payload: {
        productionModifier,
        salesModifier
    }
});
```

Dispatches `UPDATE_MODIFIERS` to set production and sales modifiers on `authCompany`.

---

## 11. Money Changes — `Rs()`

**File:** `chunk_FOr.js:356-364`

```js
export const Rs = (t)=>(e)=>{
    if (t > 0) {
        Ea.play(Sa.MoneyIncrease);
    }
    e({
        type: BU,
        payload: t
    });
};
```

- Dispatches `ADD_MONEY` with signed amount
- Plays cash sound effect on positive amounts
- Reducer (`chunk_FOr.js:130-136`): `money = oldMoney + payload`

Also `k5()` dispatches `UPDATE_MONEY` for server-authoritative money updates (includes transaction ID for ordering).

---

## 12. Redux State Shape

**File:** `chunk_FOr.js:66-115`

```js
const zOr = {
    administrationOverhead: undefined,       // current AO multiplier
    administrationOverheadPlusOne: undefined, // AO with +1 admin
    fetchingAdministrationOverhead: false,
    fetchingAdministrationOverheadPlusOne: false,
    productionModifier: undefined,
    salesModifier: undefined,
    // ...
};
```

Action types (constants in `chunk_FOr.js`):
- `YIt` = `FETCH_ADMINISTRATION_OVERHEAD` — sets fetching=true
- `ZIt` = `FETCH_ADMINISTRATION_OVERHEAD_ERROR` — sets fetching=false
- `vme` = `ADD_ADMINISTRATION_OVERHEAD` — stores payload, sets fetching=false
- `KIt` = `FETCH_ADMINISTRATION_OVERHEAD_PLUS_ONE` — sets fetching=true
- `XIt` = `FETCH_ADMINISTRATION_OVERHEAD_PLUS_ONE_ERROR` — sets fetching=false
- `yme` = `ADD_ADMINISTRATION_OVERHEAD_PLUS_ONE` — stores payload, sets fetching=false
- `HIt` = `UPDATE_MODIFIERS` — updates productionModifier/salesModifier on authCompany

---

## 13. Complete Production Cost Formula

From `chunk_Uai.js:183-188` and `chunk_XLi.js:481-482`:

```
effectiveOverhead   = ph(administrationOverhead, skillCOO)
                     = AO − (AO−1) × skillCOO / 100

adminCostPerTick    = wages × effectiveOverhead
                     = 345 × salaryModifier × building.size × effectiveOverhead

hourlyCost          = adminCostPerTick × (secondsPerHour)
```

### Retail Sales Cost (from `chunk_Fci.js:1726`):
```
retailCost = floor( wages × ph(AO, skillCOO) × 47 × (100 − (salesModifier + recreationBonus + floor(skillCMO/3))) / 100 )
```

### Restaurant Cost (from `chunk_wsi.js:2325-2327`):
```
effectiveOverhead   = ph(administrationOverhead, skillCOO)
restaurantCost      = ceil( wages × size × effectiveOverhead × restaurantMultiplier / 3600 )
```

---

## 14. API Endpoints

| Endpoint | Usage |
|---|---|
| `api_v2_companies_administration_overhead()` | GET current AO |
| `api_v2_companies_administration_overhead_plus_one()` | GET AO with +1 admin |

Both are proxied through `eo()` helper which dispatches FETCH/FETCH_ERROR actions and calls the success callback with `{ data }`.

---

## Summary of Key Formulas

```
i = buildingPoints = Σ(building.size × 100) for non-HQ, non-free buildings

AO = administrationOverhead (server-computed multiplier, e.g. 1.10)

AO_plusOne = administrationOverheadPlusOne (AO if +1 admin)

skillCOO = floor(s5t(BT(executives, "coo")))
  BT: Σ skills × multiplier (1.0 exact / 0.5 apprentice / 0.25 other)
  s5t: soft-cap at 60 and 80

effectiveAO = AO − (AO−1) × skillCOO / 100

wagesPerTick = 345 × salaryModifier × building.size

adminCostPerTick = wagesPerTick × effectiveAO

moreAdminsCost = (AO_plusOne−1) × (i+100) − (AO−1) × i

maxAdmins = min(floor(i/4), 12)
```
