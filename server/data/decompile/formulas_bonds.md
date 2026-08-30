# Sim Companies - Bonds System

> Extracted from decompiled JS modules: `chunk_CFi_2.js`, `chunk_GSi.js`, `chunk_I6i.js`, `chunk_S1.js`, `chunk_WFi.js`, `chunk_fYe.js`, `chunk_hdi.js`, `chunk_mBt.js`, `chunk_rMi.js`, `chunk_rpi.js`, `chunk_Ggi.js`, `chunk_HGt.js`, `chunk_smi.js`, `chunk_EA.js`, `chunk_zjr.js`, `chunk_Mor_2.js`, `chunk_mBt.js`, `chunk_dde.js`, `entry.js`

---

## 1. Bond Face Value

| Constant | Value | Source |
|----------|-------|--------|
| `go` | **$5,000** per bond unit | `chunk_zjr.js` |

A bond unit always has a face value of $5,000. All amounts are expressed in integer units.

---

## 2. Bond Ratings

### 2.1 Rating Scale (ordered best → worst)

| Rating | Group |
|--------|-------|
| AAA | AAA to AA |
| AA+ | AAA to AA |
| AA | AAA to AA |
| AA- | AA- to A |
| A+ | AA- to A |
| A | AA- to A |
| A- | A- to BBB |
| BBB+ | A- to BBB |
| BBB | A- to BBB |
| BBB- | BBB- to BB |
| BB+ | BBB- to BB |
| BB | BBB- to BB |
| BB- | BB- to B |
| B+ | BB- to B |
| B | BB- to B |
| B- | B- to C |
| C | B- to C |
| D | D to D |

Defined in `chunk_zjr.js` (`DWe` array) and `chunk_WFi.js` (`PL` array).

### 2.2 Rating Filter Groups (UI)

The exchange UI groups ratings into 7 filter buckets (`chunk_CFi_2.js`, `FFi` / `_1t`):

| Filter | Ratings Included |
|--------|-----------------|
| AAA to AA | AAA, AA+, AA |
| AA- to A | AA-, A+, A |
| A- to BBB | A-, BBB+, BBB |
| BBB- to BB | BBB-, BB+, BB |
| BB- to B | BB-, B+, B |
| B- to C | B-, C |
| D to D | D |

### 2.3 Rating Agency Criteria

The rating agency (server-side, exact formula undisclosed) considers:

- Whether the company is managed daily
- Asset value
- Bond holdings (investment in bonds)
- Current bond liabilities (bonds payable)
- Cashflow
- Company level
- Certificates earned
- Whether interest payments were paid on time in the past
- **Bad ratings persist longer if the company defaults on bonds**

Source: `entry.js` encyclopedia strings.

---

## 3. Interest Rate Mechanics

### 3.1 Interest Rate Range

Per-realm configured:

| Realm | Min Interest | Max Interest | Step |
|-------|-------------|-------------|------|
| Magnates (0) | 0.5% | 2.0% | 0.1% |
| Entrepreneurs (1) | 0.5% | 2.0% | 0.1% |

Configured in `entry.js:s_` under `bondsMinInterest` / `bondsMaxInterest`.

The interest rate is adjustable in 0.1% steps: `Math.round(n * 10 + e) / 10` (`chunk_smi.js:94`).

### 3.2 Daily Interest Payment Formula

**Per bond unit per day:**

```
dailyInterest = Math.floor(amount × 50 × interestRate)
```

Where:
- `amount` = number of bond units owned
- `interestRate` = the bond's interest rate (as a percentage, e.g. 1.5 for 1.5%)
- `Math.floor()` rounds down to nearest dollar

Source: `chunk_EA.js:108` and `chunk_HGt.js:598`

**Example:** 100 bonds at 1.5% interest:
- Daily: `Math.floor(100 × 50 × 1.5) = Math.floor(7500) = $7,500/day`

### 3.3 Annualized Interest Cost/Yield

Displayed as per-period (likely per tick) interest:

```
periodInterest = Math.floor(amount × go × interestRate) / 100
```

Where `go = 5000`. This appears as the total interest expense/income per accounting period.

Source: `chunk_smi.js:104-105`

**Example:** 100 issued bonds at 1.5%:
- Period interest: `Math.floor(100 × 5000 × 1.5) / 100 = Math.floor(750000) / 100 = $7,500`

---

## 4. Bond Issuance Flow

### 4.1 Eligibility

- **Minimum level: 10** (`chunk_fYe.js:NVr`: "Bonds are available from level 10 onwards.")
- Realm must have bonds enabled (`realm.bonds === true`)
- Company must have `capabilities.bonds` (from `levelInfo`)

### 4.2 Maximum Bonds (Collateral Limit)

The number of bonds a company can issue is limited by building collateral:

```
maxBonds = max(0, floor(totalBuildingValue / 5000) - alreadySoldBonds)
```

Where:
- `totalBuildingValue` = sum of `building.cost × building.size` for all owned buildings
- `alreadySoldBonds` = sum of `amount` of all currently outstanding sold bonds

Source: `chunk_smi.js:262-271`

This means: **you can issue bonds up to the total value of your buildings**. Bonds are effectively collateralized by buildings.

### 4.3 Issuing / Adjusting Bonds

**API Call:** `PATCH /api/bonds/`

Payload:
```json
{
  "amount": <bondUnits>,    // bondCash / 5000
  "interest": <rate>        // e.g. 1.5 for 1.5%
}
```

Source: `chunk_Ggi.js:Vgi`

**UI Flow** (`chunk_smi.js`):
1. User sets bond cash amount (stepped by $5,000) and interest rate
2. Interest rate defaults to 0.5%
3. On submit, `Vgi(bondCash / go, interest)` is called
4. On success, data refreshes with updated market amounts
5. Bonds appear on the exchange immediately

The issuer can adjust the amount and interest of their bond offering **any time** (before it's fully sold). Only unsold portions can be adjusted.

### 4.4 Bond Offering Display

On the exchange, each bond offering shows:
- Issuer company (logo, name, realm, certificates, contest wins)
- **Rating** (e.g. "AAA")
- **Amount** (number of bonds available, e.g. "150x")
- **Value** (`amount × $5,000`)
- **Interest rate** (e.g. "1.50%")
- **Daily yield** (`Math.floor(amount × 50 × interest)`)

Source: `chunk_CFi_2.js:VFi`

---

## 5. Bond Purchase Flow

### 5.1 Purchase Restrictions

1. **Level requirement:** Level 10+ to access bonds at all
2. **Affiliation:** Cannot buy bonds from affiliated companies (`chunk_fYe.js:DVr`)
3. **Self-purchase:** Cannot buy your own bonds (UI shows "Adjust" button instead)
4. **Purchase limits by buyer level** (from changelog `chunk_I6i.js:942`):
   - Level 1-14: **1%** of issuer's total bonds
   - Level 15-19: **3%** of issuer's total bonds
   - Level 20+: **5%** of issuer's total bonds

### 5.2 Purchase API

**API Call:** `PATCH /api/bonds/{bondId}/`

Payload:
```json
{
  "amount": <numberOfBonds>,  // how many bond units to buy
  "interest": <bondInterestRate>,  // the bond's current interest rate
  "buyer": "me"
}
```

Source: `chunk_Ggi.js:Ygi`

### 5.3 Purchase UI Flow (`chunk_HGt.js:rUi`)

1. User navigates to `/market/bond/{bondId}/`
2. Sees issuer details, rating, available amount
3. Enters number of bonds to purchase (max = available)
4. Sees daily yield preview: `Math.floor(amount × 50 × interestRate)`
5. Submits → calls `Ygi(bondId, amount, interest)`
6. On success: success toast, money deducted (`-$5000 × amount`), redirected to bonds listing

### 5.4 Merge on Purchase

When buying bonds from the same issuer at the same interest rate, purchases are merged into a single bond holding (`chunk_I6i.js:1680`).

---

## 6. Bond Maturity & Call Mechanics

### 6.1 Holding Period

- Bonds have **no fixed maturity date** — they pay interest indefinitely
- **14-day lock period** from purchase date before issuer can call them back:
  ```
  callableAfter = purchased_at + 14 days (in ms)
  ```
  Source: `chunk_smi.js:389, 538, 717`

### 6.2 Calling Bonds Back (Issuer)

**API Call:** `PUT /api/bonds/{bondId}/`

Payload:
```json
{
  "amount": <cashAmount / 5000>  // full face value
}
```

Source: `chunk_Ggi.js` (no function exported, called inline), `chunk_smi.js:473-474`

**Mechanics** (`chunk_smi.js:465-495`):
1. Issuer selects bonds to call back (stepped by $5,000)
2. Must have sufficient cash (`callAmount <= money`)
3. API call deducts the cash and returns remaining bond amount
4. Bond holder receives the face value back

**Call amount** = `amount × $5,000` (face value)

### 6.3 Bond Calling Rules

- Bonds can only be called **after the 14-day lock period** (`b < 0` check in `chunk_smi.js:730`)
- Before 14 days: UI shows countdown timer
- After 14 days: "Call" button appears
- Issuer can call partial amounts (any multiple of $5,000 up to the remaining amount)

---

## 7. Default / Risk Mechanics

### 7.1 Default Triggers

When a bond issuer cannot pay interest (insufficient cash), they **default**. The exact cash threshold is server-side.

### 7.2 Consequences

From changelogs and encyclopedia entries:

1. **Issuer (Defaulter):**
   - Always pays **100% of the borrowed value** (face value) — updated August 1st
   - Rating downgrade that persists longer
   - Bond writeoffs appear on income statement as "Write offs" (gain for defaulter)
   - Source: `chunk_I6i.js:1370`, `entry.js:16938`

2. **Bond Holder (Creditor):**
   - Receives at minimum the **restructure percentage** of face value
   - Loss recorded as "Defaults" on income statement
   - "Defaulted bonds you owned - value lost"
   - Source: `entry.js:16946`

### 7.3 Restructure Percentage

Each bond has a `restructure_percentage` field that determines recovery on default:

- Newly issued bonds: `restructure_percentage: 0` (default, meaning full default risk)
- Displayed on owned bonds as: "Restructure percentage: {percent}%"
- Encyclopedia: "In case of default, a restructured percentage of the bond face value is recovered by the bond holder."

The restructure percentage increases over time (server-side mechanic, exact formula undisclosed in client code).

### 7.4 Transaction Types for Default Events

| Transaction Type | Label | Meaning |
|-----------------|-------|---------|
| `RESTRUCTURED_BOND_CALL` | "Restructured {percent}% bond call" | Bond called at restructured value |
| `INSOLVENCY_BOND_CALL` | "Insolvency proceedings bond call" | Bond called during insolvency |
| `BOND_LIQUIDATED` | (bond liquidated) | Bond forcibly liquidated |

Source: `chunk_mBt.js:135-137, 209-228`

### 7.5 Missed Payments Tracking

Each owned bond tracks:
- `interestCollected` — total interest collected so far
- `missed_payments` — number of missed interest payments
- `purchased_at` — purchase date

Displayed on owned bonds in the finance page.

Source: `chunk_smi.js:663-683`

---

## 8. Financial Statement Impact

### 8.1 Balance Sheet

| Item | Account ID | Description |
|------|-----------|-------------|
| **Assets** | | |
| `investmentInBonds` | "Investment in bonds" | Cash spent on buying others' bonds |
| **Liabilities** | | |
| `bondsPayable` | "Bonds Payable" | Face value of bonds you issued (debt) |

### 8.2 Income Statement

| Item | Account ID | Description |
|------|-----------|-------------|
| `bondInterestIncome` | "Interest income" | Interest received from bonds you own |
| `bondInterestExpense` | "Interest expense" | Interest paid on bonds you issued |
| `bondWriteoffs` | "Write offs" | Value gained by defaulting on your debt |
| `bondDefaults` | "Defaults" | Value lost from others defaulting on bonds you own |

### 8.3 Key Financial Ratios

| Ratio | Formula | Source |
|-------|---------|--------|
| **Interest Coverage** | `totalExpenses / -bondInterestExpense` | `chunk_rpi.js:522` |
| **Debt to Building** | `bondsPayable / buildings` | `chunk_rpi.js:523` |

---

## 9. API Endpoints

All endpoints from `chunk_Mor_2.js` (route builder function `F()`) and `chunk_Ggi.js` (API client functions):

### 9.1 Public / Market Routes

| Route | Function | Description |
|-------|----------|-------------|
| `GET /api/bonds/` | `Ggi()` | List all issued bonds on market |
| `GET /api/bonds/rating/{rating}/` | `qgi(rating)` | Get bonds filtered by rating range (e.g. "AAA-to-D") |
| `GET /api/bonds/{id}/` | `Wgi(id)` | Get single bond details |

### 9.2 Issuer Actions

| Method | Route | Function | Description |
|--------|-------|----------|-------------|
| `PATCH /api/bonds/` | `Vgi(amount, interest)` | Issue or adjust bond offering |
| `PUT /api/bonds/{id}/` | (inline) | Call back bonds (issuer repays) |

### 9.3 Buyer Actions

| Method | Route | Function | Description |
|--------|-------|----------|-------------|
| `PATCH /api/bonds/{id}/` | `Ygi(id, amount, interest)` | Purchase bonds (with `buyer: "me"`) |

### 9.4 Company-Level Bond Data

| Route | Description |
|-------|-------------|
| `GET /api/v2/companies/{id}/bonds/owned/` | Bonds owned by a company |
| `GET /api/v2/companies/{id}/bonds/sold/` | Bonds sold/issued by a company |

### 9.5 Frontend Routes

| Path | Component | Description |
|------|-----------|-------------|
| `/market/bonds/` | `eji` | Bonds exchange listing |
| `/market/bond/{bond_id}/` | `rUi` | Single bond detail & purchase |
| `/market/bonds/{filter}/` | — | Bonds filtered by rating range |

Source: `chunk_fVi.js:1350-1356`, `chunk_WFi.js:eji`, `chunk_HGt.js:rUi`

---

## 10. Cash Flow Categories

Bond transactions are categorized under a combined cash flow category:

**Category:** `[BONDS, BOND_DEFAULTS, OWN_BONDS]` → Label: `NDr`

Source: `chunk_dde.js:39-43`

### Transaction Types (from `chunk_mBt.js`)

| Constant | Label |
|----------|-------|
| `BOND_INTEREST` | "Bond interest payment" |
| `BOND_YIELD` | "Bond yield" |
| `BOND_CALL` | (bond call) |
| `BOND_INVESTMENT` | (bond investment/purchase) |
| `BOND_SALES` | (bond sales) |
| `RESTRUCTURED_BOND_CALL` | "Restructured {percent}% bond call" |
| `INSOLVENCY_BOND_CALL` | "Insolvency proceedings bond call" |
| `BOND_LIQUIDATED` | (bond liquidated) |

---

## 11. Summary of Key Formulas

| Formula | Expression | Units |
|---------|-----------|-------|
| **Face value** | `amount × $5,000` | dollars |
| **Daily interest** | `Math.floor(amount × 50 × interestRate%)` | dollars/day |
| **Period interest cost** | `Math.floor(amount × $5,000 × interestRate%) / 100` | dollars/period |
| **Max issuable bonds** | `max(0, floor(Σ(building.cost × size) / 5000) - totalSold)` | bond units |
| **Interest rate step** | `Math.round(currentRate × 10 + step) / 10` | 0.1% increment |
| **Call lock period** | `purchased_at + 14 days` | timestamp |
| **Debt-to-building** | `bondsPayable / buildings` | ratio |
| **Interest coverage** | `totalExpenses / -bondInterestExpense` | ratio |
