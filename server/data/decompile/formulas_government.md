# Government Orders System

## Overview

Government agencies post projects requiring resources. Companies form bids with multiple contractors. Lowest bid wins. Contractors deliver resources to fulfill the order and receive government compensation.

Source: `chunk_D1r.js`, `chunk_Nzi.js`, `chunk__ii.js`, `chunk_cji.js`, `chunk_fVi.js`, `chunk_fYe.js`, `chunk_gOn_2.js`, `chunk_kkt.js`, `chunk_mBt.js`, `chunk_D1e.js`, `chunk_Mzi.js`, `entry.js`

---

## System Parameters

All constants in `entry.js:36375-36387` (`Rl` object):

| Parameter | Var | Value | Description |
|---|---|---|---|
| `minContractors` | `Y5n` | 3 | Minimum contractors per bid |
| `maxContractors` | `Z5n` | 7 | Maximum contractors per bid |
| `biddingPeriodDays` | `K5n` | 5 | Days from bid creation to awarding deadline |
| `depositRatio` | `X5n` | 0.1 (10%) | Security deposit as fraction of estimated value |
| `hourOfDayUTC` | `Q5n` | 13 | UTC hour for deadline cutoff |
| `generateDayOfWeek` | `J5n` | 2 (Tuesday) | Day of week bids are generated |
| `awardDayOfWeek` | `eIn` | 0 (Sunday) | Day of week bids are awarded |
| `noEditHours` | `tIn` | 24 | Hours before deadline when editing is locked |
| `noteMaxLength` | `rIn` | 1024 | Max characters for bid note |

---

## Tier System

### Data Model

Tier data is fetched from API endpoint `api_v3_government_orders_tier` (function `vcr()` in `chunk_kkt.js:42-44`). Returns `{ tier: { tierIndex, resourceMultiplicator } }`.

Each company has a `companyTier` with:

| Field | Type | Description |
|---|---|---|
| `tierIndex` | number | Numerical tier level (higher = more resources needed, displayed as T1, T2, T3...) |
| `resourceMultiplicator` | number | Multiplier applied to base resource amounts for this tier |

### How Tiers Work

- Higher `tierIndex` = company gets a larger share of the required resources
- The `resourceMultiplicator` determines the proportion of base resources allocated to a tier
- Resource allocation across contractors uses tier-weighted proportional distribution via `Rzi()` function (`entry.js:60962-60979`)
- `resourceMultiplierAwarded` on a template: if set, the order was already awarded and has a fixed multiplier; otherwise `companyTier.resourceMultiplicator` is used

### Tier Display

- Company tier shown as "T{tierIndex}" (e.g. T1, T2, T3...)
- `minimumRequiredTierIndex`: only companies with tier >= this value can join the bid
- Tier affects both resource amounts needed AND deposit amount
- On visit to government orders page, `vcr()` is called to fetch the current company's tier

---

## Government Order Template (Projects)

### Data Structure

Template defines what resources the government needs. Arrives from API `api_v3_government_orders` or `api_v3_government_orders_get`.

Each template has:

| Field | Description |
|---|---|
| `id` | Template ID |
| `realm` | Realm ID |
| `projectKey` | Project key (maps to `GH` / `Rl.projects`) |
| `agency` | Government agency (implied via project) |
| `estimatedBaseValue` | Base monetary value estimate |
| `daysToFulfill` | Days to fulfill after awarding |
| `resourceMultiplierAwarded` | Fixed multiplier if already awarded (null during bidding) |
| `created` | Creation timestamp |
| `governmentorderrequiredresourceSet` | Array of required resources |

### Required Resource Entry

Each resource in `governmentorderrequiredresourceSet`:

| Field | Type | Description |
|---|---|---|
| `id` | number | Entry ID |
| `kind` | number | Resource type ID |
| `quality` | number | Minimum quality required (must be >= this) |
| `amountBase` | number | Base amount before tier multiplier |

### Built-in Projects (Client-side)

Defined in `entry.js:36374` (`iIn` JSON). Each project:

| Field | Description |
|---|---|
| `agency` | Which government agency (maps to `Rl.agencies`) |
| `enabled` | Whether the project is active |
| `resources` | Array of `{ weight, kind }` — weight determines resource distribution proportions |

**Agencies** (from `entry.js:36309-36372`):

| Agency Key | Logo |
|---|---|
| `FIRE_DEPARTMENT` | `images/agencies/fire-department.png` |
| `NATURAL_DISASTER_RELIEF_AGENCY` | `images/agencies/natural-disaster-relief-agency.png` |
| `CITY_ZOO` | (defined) |
| `CITY_PUBLIC_TRANSPORT` | (defined) |
| `PUBLIC_HEALTH_DEPARTMENT` | (defined) |
| `DEPARTMENT_OF_AGRICULTURE` | (defined) |
| `ENVIRONMENTAL_PROTECTION_AGENCY` | (defined) |
| `ENERGY_DEPARTMENT` | (defined) |
| `DEPARTMENT_OF_COMMERCE` | (defined) |
| `DEPARTMENT_OF_DEFENSE` | (defined) |
| `DEPARTMENT_OF_EDUCATION` | (defined) |
| `DEPARTMENT_OF_HOUSING` | (defined) |
| `SPACE_EXPLORATION_AGENCY` | (defined) |
| `NATIONAL_FOOD_AGENCY` | (defined) |
| `FORESTRY_DEPARTMENT` | (defined) |
| `TRANSPORTATION_SAFETY_BOARD` | (defined) |
| `ECONOMIC_DEVELOPMENT_AGENCY` | (defined) |
| `MINING_AND_RESOURCES_AGENCY` | (defined) |
| `FOREIGN_AFFAIRS_DEPARTMENT` | (defined) |
| `TOWN_HALL` | (defined) |
| `NATIONAL_ARTS_AGENCY` | (defined) |

---

## Bidding Mechanics

### Bid (Application) Data Model

A bid (called "Application" in the API) is created from a template:

| Field | Description |
|---|---|
| `secret` | Unique bid identifier (shown as "Bid #...") |
| `templateId` | Parent template ID |
| `maxContractorCount` | Max contractors for this bid (3–7, set by creator) |
| `isPublic` | Bid visibility: public (listed) or invite-only |
| `minimumRequiredTierIndex` | Minimum tier to join |
| `resourcePriceBreakdown` | JSON string: `{ resourceKind: pricePerUnit }` — bid prices per resource |
| `note` | Optional note (max 1024 chars) |
| `governmentorderbidderSet` | Array of bidders (contractors) |

### Bidder (Contractor) Entry

Each entry in `governmentorderbidderSet` (`N1e` function, `entry.js:60944-60961`):

| Field | Description |
|---|---|
| `id` | Bidder ID (-1 for placeholder) |
| `companyId` | Company ID |
| `isMainContractor` | Whether this is the bid creator |
| `tierIndex` | Company's tier |
| `tierResourceMultiplicator` | Company's tier resource multiplier |
| `fulfilled` | Whether contractor has delivered their resources |
| `depositPaid` | Deposit amount paid (or computed if 0) |
| `company` | Nested company info: `{ id, company, logo, realmId, deleted }` |

### Creating a Bid

1. **Main Contractor** visits a template page and clicks "Create Bid"
2. Sets:
   - `maxContractorCount` (3–7)
   - `isPublic` (listed or invite-only)
   - `resourcePriceBreakdown` — per-resource bid prices (how much contractor charges government per resource unit)
   - `minimumRequiredTierIndex`
3. POST to `api_v3_government_orders_applications` (`Ecr` function)
4. Main contractor becomes first bidder with `isMainContractor: true`

### Joining a Bid

1. Other companies can join if:
   - Bid has open slots (`governmentorderbidderSet.length < maxContractorCount`)
   - Their tier >= `minimumRequiredTierIndex`
   - Bid is public, or they have the secret link
2. POST to `api_v3_government_orders_applications_contractors` (`xcr`)
3. A placeholder bidder entry is created with their tier

### Resource Allocation (D1e function)

`D1e(template, maxContractors, bidders)` in `chunk_D1e.js:2-42`:

1. Sort bidders by tier index descending; take the highest tier
2. If fewer bidders than max slots, fill with pretend bidders at the top tier
3. Sort all bidders by `tierResourceMultiplicator` ascending
4. For each bidder, compute their share via `Rzi(bidder, allBidders, maxContractors)`:
   - Higher tier gets a larger `computedResourceMultiplicator`
   - `computedResourcesNeeded[kind].amount = Math.max(1, Math.ceil(amountBase * computedResourceMultiplicator))`
   - `computedResourcesNeeded[kind].quality` = required quality from template
5. Returns:
   - `topTierIndex` — highest tier among bidders
   - `topTierResourceMultiplicator` — multiplier of top tier
   - `bidderData` — each bidder with computed resources
   - `totalAmounts` — sum of all resources needed
   - `isApplicationComplete` — whether all slots are filled

### Bidding Deadline

- Bidding period: `biddingPeriodDays` (5 days)
- Editing locks `noEditHours` (24 hours) before deadline
- Deadline countdown shown: `"Bidding deadline: {countdown}"` (i18n key `eWr`)
- After deadline, bids are awarded server-side

### Editing Lock

24 hours before bidding deadline:
- Cannot change `maxContractorCount`, `isPublic`, `minimumRequiredTierIndex`, or `resourcePriceBreakdown`
- i18n: `"Editing parameters of the bid is locked {hours} hours before the bidding deadline."`

---

## Deposit Calculation

### Formula

```javascript
deposit = Math.floor(estimatedBaseValue * resourceMultiplicator * depositRatio)
```

From `Mzi(t, e)` in `chunk_Mzi.js:2-4`:
```javascript
function Mzi(estimatedBaseValue, resourceMultiplicator) {
    return Math.floor(estimatedBaseValue * resourceMultiplicator * Rl.depositRatio);
}
```

Where `Rl.depositRatio = 0.1` (10%).

- The deposit amount is displayed in the bidder's row
- If `depositPaid` is 0 on a bidder entry, the UI computes it dynamically as `Mzi(estimatedBaseValue, resourceMultiplicator)`
- Deposit transactions:
  - `GOVERNMENT_ORDER_DEPOSIT` — deposit paid (`1-godeposit`)
  - `GOVERNMENT_ORDER_DEPOSIT_RETURNED` — returned on success (`1-godeposit-ret`)
  - `GOVERNMENT_ORDER_DEPOSIT_LOST` — lost on failure/abandonment (`1-godeposit-lost`)

---

## Reward Calculation

### Contractor Reward (bidderReward)

From `bB()` in `entry.js:60981-60986`:

```javascript
function bB(computedResources, resourceBidPrices) {
    const isValid = (n) => n !== undefined && n !== "" && !isNaN(Number(n));
    if (!Object.keys(computedResources).some((k) => !isValid(resourceBidPrices[parseInt(k, 10)]))) {
        return Math.floor(
            Object.entries(computedResources).reduce(
                (sum, [kind, amount]) => sum + amount * Number(resourceBidPrices[parseInt(kind, 10)]),
                0
            )
        );
    }
}
```

**Formula:**
```
bidderReward = floor( sum over all resource kinds: computedAmount * bidPricePerUnit )
```

Where:
- `computedAmount` = `Math.max(1, Math.ceil(amountBase * computedResourceMultiplicator))`
- `bidPricePerUnit` = price set by the main contractor in `resourcePriceBreakdown`

The reward is the total government compensation for delivering all required resources.

### Key Concept: Lowest Bid Wins

The i18n description states: `"Companies willing to put down deposit can bid, lowest bid wins."`

The `resourcePriceBreakdown` set by the main contractor is essentially the "bid price" — how much they charge the government per unit of each resource. Lower total bid = more competitive.

---

## Contract Fulfillment Flow

### 1. Bidding Phase (5 days)
- Main contractor creates bid with resource prices and contractor count
- Other companies join as subcontractors
- Resource allocation computed based on tier distribution
- Each bidder sees their required resources, deposit amount, and potential reward
- 24 hours before deadline: editing locks

### 2. Awarding
- Server awards bids at deadline (day of week = `awardDayOfWeek` = Sunday, hour = `hourOfDayUTC` = 13:00 UTC)
- Awarded bid gets `resourceMultiplierAwarded` set on the template
- `daysToFulfill` countdown begins

### 3. Fulfillment Phase
- Each contractor must deliver their `computedResourcesNeeded`
- Quality requirement: resource quality must be >= `requiredQuality` from template
- Main contractor can fulfill their own share
- Main contractor can fulfill on behalf of others (admin/override via `cBe` API call)
- Each fulfillment triggers:
  - Resources consumed from warehouse (`Wp` reducer action)
  - Money received as government compensation
  - Transaction logged as `GOVERNMENT_ORDER_FULFILLED` (`1-gofullfil`)

### 4. Completion
- `isApplicationComplete` = all contractor slots filled
- Bid is "fulfilled by everyone" when all `fulfilled` flags are true
- Deposits returned to successful contractors
- Failed/abandoned bids lose deposit

---

## Minimum Quality Thresholds

From the fulfillment check logic in `chunk_Nzi.js:470` and `chunk_Nzi.js:954`:

```javascript
// Check if warehouse resources satisfy quality requirement:
resources.filter(r => r.kind === requiredKind && r.quality >= requiredQuality)
    .reduce((sum, r) => sum + r.amount, 0) / requiredAmount
```

- Each required resource has a minimum `quality` field from the template
- Delivery requires resources with quality >= the template's quality requirement
- Progress percentage shown: `Math.min(100, 100 * availableResources / neededResources)`

---

## API Endpoints

| Function | Endpoint Pattern | Method | Purpose |
|---|---|---|---|
| `gcr` | `api_v3_government_orders` | GET | List all orders |
| `mcr` | `api_v3_government_orders_get` | GET | Get specific order template |
| `vcr` | `api_v3_government_orders_tier` | GET | Get company tier |
| `ycr` | `api_v3_government_orders_applications` | GET | List applications for template |
| `bcr` | `api_v3_government_orders_applications_get` | GET | Get specific application |
| `_cr` | `api_v3_government_orders_company_applications` | GET | Get company's applications |
| `Ecr` | `api_v3_government_orders_applications` | POST | Create new application (bid) |
| `lBe` | `api_v3_government_orders_applications_get` | PATCH | Update application parameters |
| `wcr` | `api_v3_government_orders_applications_get` | DELETE | Delete application |
| `xcr` | `api_v3_government_orders_applications_contractors` | POST | Join as contractor |
| `cBe` | `api_v3_government_orders_applications_contractors_get` | PATCH | Fulfill contract |
| `Scr` | `api_v3_government_orders_applications_contractors_get` | DELETE | Remove contractor |

---

## Transaction Types

| Constant | Cash Flow ID | Display Name |
|---|---|---|
| `GOVERNMENT_ORDER_FULFILLED` | `1-gofullfil` | "Government order fulfilled" |
| `GOVERNMENT_ORDER_DEPOSIT` | `1-godeposit` | "Government order security deposit" |
| `GOVERNMENT_ORDER_DEPOSIT_RETURNED` | `1-godeposit-ret` | "Government order security deposit returned" |
| `GOVERNMENT_ORDER_DEPOSIT_LOST` | `1-godeposit-lost` | "Government order security deposit lost" |

---

## Fulfillment Deadline

From `wI()` in `chunk_Mzi.js:33-35`:

```javascript
function wI(template) {
    return Date.parse(template.created) + (Rl.biddingPeriodDays + template.daysToFulfill) * 24 * 60 * 60 * 1000;
}
```

Total time from creation to fulfillment deadline = `biddingPeriodDays (5) + daysToFulfill` days.

---

## Key UI Components

| Component | File | Purpose |
|---|---|---|
| `AGi` | `chunk_Nzi.js:656` | Main government orders listing page |
| `rVt` | `chunk_Nzi.js:313` | Single application row in listing |
| `Zzi` | `chunk_Nzi.js:89` | Single template/order card |
| `nVt` | `chunk_Nzi.js:858` | Bidder row showing tier, resources, reward |
| `IVi` | `chunk_fVi.js:463` | Template detail page |
| `XVi` | `chunk_fVi.js` | Application detail page (existing bid) |
| `wVi` | `chunk_fVi.js` | New application creation page |
| `QVi` | `chunk_fVi.js:1281` | Router for government orders section |
