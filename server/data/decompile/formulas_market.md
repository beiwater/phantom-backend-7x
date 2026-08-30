# Sim Companies — Market & Exchange Formulas

> Extracted from decompiled JS modules. All prices in SimCo dollars ($).

## 1. Constants

| Constant | Value | Source |
|---|---|---|
| `AVERAGE_SALARY` | 345 | `chunk_oX.js:4847` |
| `ROBOT_COST` | 940 | `chunk_oX.js:4855` |
| `RETAIL_MODELING_QUALITY_WEIGHT` | 0.3 | `chunk_oX.js:4961` |
| `Zor` (retail saturation scalar) | 370 | `entry.js:4619` |
| `isr.B` (building category "B" modifier) | 2.28 | `entry.js:4724-4725` |
| `SALARY_MID` | {0: 655, 1: 700, 2: 745} | `chunk_oX.js:4850-4854` |
| Realm 0 exchange fee | 4% (0.04) | `entry.js:4641` |
| Realm 1 exchange fee | 4% (0.04) | `entry.js:4663` |

---

## 2. Price Tick System

Prices on the exchange must conform to a tick grid. The function `U0(price)` returns `[numerator, denominator]` — the tick size is `numerator / denominator`.

| Price Range | Tick Size | `U0` returns |
|---|---|---|
| ≥ 20,000 | 500.00 | `[500, 1]` |
| 10,000 – 19,999.99 | 100.00 | `[100, 1]` |
| 5,000 – 9,999.99 | 25.00 | `[25, 1]` |
| 1,000 – 4,999.99 | 10.00 | `[10, 1]` |
| 500 – 999.99 | 5.00 | `[5, 1]` |
| 200 – 499.99 | 2.00 | `[2, 1]` |
| 100 – 199.99 | 1.00 | `[1, 1]` |
| 50 – 99.99 | 0.50 | `[1, 2]` |
| 20 – 49.99 | 0.25 | `[1, 4]` |
| 5 – 19.99 | 0.10 | `[1, 10]` |
| 2 – 4.99 | 0.05 | `[1, 20]` |
| 1 – 1.99 | 0.01 | `[1, 100]` |
| 0.5 – 0.99 | 0.005 | `[1, 200]` |
| < 0.5 | 0.001 | `[1, 1000]` |

**Usage**: When a user enters a price, the UI validates it against the tick. Prices not on the tick are rejected.

**Source**: `entry.js:4500-4599` (Vor array), `entry.js:18778-18792` (U0 function).

---

## 3. Exchange Fee

Each realm charges a flat percentage fee on every exchange transaction:

```
fee = ceil(amount × price × exchangeFee)
```

- Realm 0 (Magnates): 4%
- Realm 1 (Entrepreneurs): 4%

The fee is deducted from the seller's proceeds. The buyer pays `amount × price` to the seller; the exchange takes the fee from the seller's side.

**Source**: `entry.js:4620-4665` (s_ realm config), `chunk_YWr.js:258`, `chunk_sBr.js:192`.

---

## 4. Exchange Sell — Profit Estimation

When listing a resource for sale, the UI shows an estimated profit:

```
revenue          = amount × price
sourceCost       = amount × unitSourceCost                    (if known)
transportUnits   = ceil(amount × transportationRate)
transportCost    = transportUnits × transportationUnitPrice   (if known)
fee              = ceil(amount × price × exchangeFee)
estimatedProfit  = revenue - sourceCost - fee - transportCost
```

Where:
- **unitSourceCost** = total production cost ÷ current stock amount (weighted average cost of all inputs used to produce the resource)
- **transportationRate** = `resource.transportation` (e.g., 0.3 means 0.3 transport units per item)
- **transportationUnitPrice** = average cost per unit of transportation in warehouse

**Source**: `chunk_YWr.js:255-264`, `chunk_DYe.js:261-278`.

---

## 5. Building Construction Cost (from Market Prices)

The `ide(ticker, costUnits)` function calculates what it would cost to buy all required construction resources at current market prices:

```
ide(ticker, costUnits) = Σ (tickerPrice[kind] × costUnits × qp[kind])
```

Where `qp` maps resource IDs to the number required per cost unit:

| Resource ID | qp | Meaning |
|---|---|---|
| 101 | 4 | 4 units per cost unit |
| 102 | 55 | 55 units per cost unit |
| 108 | 16 | 16 units per cost unit |
| 111 | 1 | 1 unit per cost unit |

If any required resource has no ticker price, the fallback is:

```
fallback = J0(costUnits) = costUnits × 10 × AVERAGE_SALARY
         = costUnits × 3450
```

**Source**: `chunk_k9.js:24-43` (ide), `chunk_lg_2.js:26-28` (J0), `entry.js:3966-3971` (qp), `entry.js:8156` (ol = Object.keys(qp)).

---

## 6. Market Ticker

The ticker is fetched from the server endpoint:

```
GET /api/v3/market-ticker/{realmId}/
```

Returns an array of `{ kind: number, price: number }` objects — one per resource kind. These are the **current exchange price** (presumably the last traded price or midpoint).

The client stores ticker data in Redux at `state.market.ticker[realmId]`. The ticker bar in the UI rotates through resources, showing their current market prices.

**Source**: `chunk_Mor_2.js:281` (API endpoint), `chunk_Pia.js:31-112` (Redux reducer), `chunk_P9i.js:2032-2108` (ticker UI component).

---

## 7. Market Order Placement

### Sell Order
```
POST /api/v2/market/order/
Body: { resourceId, price, quantity, quality, kind }
```

The server creates a sell order. On success, the order appears in the company's market orders list. Transportation is consumed: `ceil(quantity × transportationRate)`.

### Buy Order (Exchange)
```
POST /api/market/buy/orders/{resource}/{quality}
Body: { amount, minQuality, price }
```

Creates a standing buy order at a specified price.

### Market Take (Instant Buy)
```
POST /v2/market/take/
Body: { resource, quantity, quality, maxPrice, money }
```

Immediately buys from the best available sell orders up to `maxPrice`, spending at most `money`.

### Cancel Sell Order
```
DELETE /v2/market/order/cancel/{id}
```

### Cancel Buy Order
```
DELETE /api/v2/companies/market/buy/orders/get/{resource}/{quality}
```

**Source**: `chunk_kkt.js:5-13` (kkt = buy), `chunk_YWr.js:176-181` (sell order POST), `chunk_kkt.js:17-23` (dcr = buy order), `chunk_kkt.js:14-16` (ucr = cancel buy order), `chunk__ii.js:1501-1504` (cancel sell order).

---

## 8. Order Matching Logic

Order matching happens **server-side**. The client only submits orders and receives results. Key observations:

- **Market Take (`kkt`)**: The server matches against existing sell orders. Parameters `maxPrice` and `money` act as guards — the server fills orders up to the cheaper of the two limits. Returns `{ moneyDelta, amountBought }`.
- **Sell Order**: The server places a limit sell order in the order book. Returns `{ sellOrder, moneyDelta }` — `moneyDelta` is non-zero if the sell order was partially or fully filled immediately (matched against existing buy orders).
- **Standing Buy Order (`dcr`)**: Places a limit buy order. Returns the created order data.

The order book is a standard price-time priority matching engine — lowest ask (sell) and highest bid (buy) matched first. Server-enforced tick sizes ensure prices snap to the grid.

---

## 9. Retail Sales Model

The retail (store) sales model determines how many units a store sells per hour at a given price and quality level. The core function chain:

### 9.1 `kle(buildingKind, economyModel, salesModifier, quality, price, forceQuality, saturation, acceleration, size, weather)`

This is the top-level function. It calculates **units sold per hour**:

```
unitsPerHour = J7r(buildingKind, economyModel, forceQuality, saturation, salesModifier, price)
if unitsPerHour <= 0: return NaN

adjusted = unitsPerHour / size / acceleration                         // normalize to 1 building
adjusted = adjusted - adjusted × salesModifier%                       // apply sales modifier
if weather: adjusted /= weather.sellingSpeedMultiplier                // weather effect
return adjusted
```

**Source**: `chunk_kle.js:3-14`.

### 9.2 `J7r(buildingKind, economyModel, forceQuality, saturation, salesModifier, price)`

The inner retail formula:

```
// saturation → quality impact factor
d = clamp(2 - saturation, 0, 2)

// demand factor (saturation impact on willingness to buy)
p = max(0.9, d/2 + 0.5)

// quality ratio
f = quality / 12

// retail throughput (g): how fast the store can move goods
g = Zor
    × (buildingLevelsNeededPerUnitPerHour × modeledUnitsSoldAnHour + 1)
    × (isr[buildingKind] ?? 1)
    × [d/2 × (1 + f × RETAIL_MODELING_QUALITY_WEIGHT)]

// selling speed at current saturation (m)
m = modeledUnitsSoldAnHour × p

// break-even price including store overhead (v)
v = modeledProductionCostPerUnit + (g + modeledStoreWages) / m

// throughput after price adjustment (b)
a = (modeledStoreWages + g) / (price - modeledProductionCostPerUnit)²
b = g - (m - price)² × a

// final units sold per hour
result = [acceleration × (price - modeledProductionCostPerUnit) × 3600 - modeledStoreWages]
         / (b + modeledStoreWages)
```

**Source**: `chunk_kle.js:15-28` (J7r), `chunk_kle.js:32-33` (e9r), `entry.js:18580-18583` (t9r), `entry.js:18584-18586` (r9r).

### 9.3 `Bme(...)` — Sell-Through Time

Computes how many seconds it takes to sell 100 units:

```
Bme(buildingKind, economyModel, 100, quality, price, forceQuality, saturation, acceleration, size, weather)
  = 100 × 3600 / kle(...)
```

Used in the building detail view to show "sell through time" and in the optimal price calculation.

**Source**: `entry.js:18570-18573`.

### 9.4 `Q7r(...)` — Optimal Price

```
Q7r = price - size × acceleration / Bme(...)
```

Iteratively computes the price that maximizes profit per hour by balancing margin against sell-through rate.

**Source**: `entry.js:18567-18569`.

---

## 10. Economy State Model

Each resource × economy state has a model with these parameters (from `vin` / `gk`):

| Field | Meaning |
|---|---|
| `buildingLevelsNeededPerUnitPerHour` | Building levels required to produce 1 unit/hour |
| `modeledProductionCostPerUnit` | Production cost per unit (wages + materials) |
| `modeledStoreWages` | Store wages (null for non-retail resources) |
| `modeledUnitsSoldAnHour` | Base units sold per hour at 0 quality / normal saturation |

Economy states: 0, 1, 2 (different economic phases). Values differ per realm and resource.

**Source**: `chunk_Unn.js:678-682` (vin), `chunk_Unn.js:684-689` (gk).

### Economy State Effects on Production

The `gk` function returns the model for a given economy state and resource. If a quality is specified (non-null), it drills into `.quality[quality]` for quality-specific sub-models.

The economy state also affects production cost scaling:

```
productionPerHour = baseProductionPerHour
    × (1 + seasonSpeedModifier/100)
    × (AVERAGE_SALARY / SALARY_MID[economyState]) ^ salaryModifier
```

**Source**: `chunk_lg_2.js:6-15` (qx production per hour).

---

## 11. Decay Calculation

The `No({kind, amount, datetime}, now)` function calculates how much of a resource remains after decay:

This is used throughout to compute `amountConsideringDecay` for accurate stock display. [The actual decay formula is in a separate module — see resource decay documentation.]

**Source**: Referenced at `chunk_DYe.js:213-218`, `chunk_YWr.js:236-240`.

---

## 12. API Endpoints Summary

| Purpose | Method | URL |
|---|---|---|
| Get market ticker | GET | `/api/v3/market-ticker/{realmId}/` |
| Market take (instant buy) | POST | `/v2/market/take/` |
| Place sell order | POST | `/api/v2/market/order/` |
| Cancel sell order | DELETE | `/v2/market/order/cancel/{id}` |
| Place buy order | POST | `/api/market/buy/orders/{resource}/{quality}` |
| Cancel buy order | DELETE | `/api/v2/companies/market/buy/orders/get/{resource}/{quality}` |
| Get company market orders | GET | `/api/v2/companies/market/orders/{companyId}` |
| Get retail model data | GET | `/api/v4/encyclopedia/resources/retail-info/{realmId}` |
| Get resource list | GET | `/api/v3/resources/{realmId}` |
| Get market sellers | (server push / poll) | Used in ranking pages |
| Get market buyers | (server push / poll) | Used in ranking pages |
| Get government orders | GET | `/api/v3/government-orders/{realmId}` |

---

## 13. Key Data Structures

### Ticker Entry
```ts
{ kind: number; price: number }
```

### Resource Retail Entry
```ts
{
  dbLetter: number;
  quality: number | null;
  averagePrice: number;
  saturation: number;
  retailData: Array<{...}>;
}
```

### Market Order
```ts
{
  id: number;
  kind: number;
  quality: number;
  quantity: number;
  price: number;
  posted: string;       // ISO datetime
  companyId?: number;
  // ...
}
```

### Economy Model (per resource × economy state)
```ts
{
  buildingLevelsNeededPerUnitPerHour: number;
  modeledProductionCostPerUnit: number;
  modeledStoreWages: number | null;
  modeledUnitsSoldAnHour: number;
}
```
