# Executive Poaching System (Hostile Offers / "Merger & Acquisition")

> **Important**: Sim Companies does NOT have a company merger or acquisition system.  
> The "merger" mechanic refers to **executive poaching** — one company attempts to hire another company's executives via hostile offers.  
> The label "Merger & Acquisition" is historical; the actual system is **Hostile Offers / Executive Poaching**.

---

## System Overview

| Role | API Namespace | Description |
|------|--------------|-------------|
| **Poacher** | `my-offers` (v2) | Company making the offer to hire away another company's executive |
| **Employer** | `hostile-offers` (v3) | Company whose executive is being targeted |
| **Executive** | — | The employee being poached |

---

## Agency Types (`Om` enum)

Companies use agencies to search for executive candidates:

| Agency | `Om` Key | `Joe` (Fee Multiplier) | `usr` (Candidates?) | SimBoost? |
|--------|----------|------------------------|---------------------|-----------|
| In-House | `IN_HOUSE` | 0× (`Joe[1]=0`) | `usr[1]=0` | No |
| Staffing Agency | `STAFFING_AGENCY` | 0.5× (`Joe[2]=0.5`) | `usr[2]=8` | No |
| Good Agency | `GOOD_AGENCY` | 2× (`Joe[3]=2`) | `usr[3]=4` | No |
| Top Talent Agency | `TOP_TALENT_AGENCY` | 5× (`Joe[4]=5`) | `usr[4]=3` | No |

**Agency Fee Formula**:
```
agencyFee = Joe[agency] × expectedSalary
```

---

## Offer Status (`ru` enum)

Offers go through these states:

| Status | Meaning |
|--------|---------|
| `ru.FOUND` | Agency found a candidate; formal offer not yet extended |
| `ru.STANDING` | Formal offer has been extended, awaiting response |
| `ru.OUTDATED` | Candidate accepted a different offer; stale |
| `ru.REFUSED` | Candidate refused the offer |

---

## Offer Lifecycle (Poacher Side)

### 1. Search for Candidate
```
POST /api/v2/companies/executives/my-offers/

Payload: {
    slotPosition,      // executive position to fill
    skillPosition,     // required skill (COO, CFO, CMO, CTO)
    agency,            // Om.IN_HOUSE | Om.STAFFING_AGENCY | Om.GOOD_AGENCY | Om.TOP_TALENT_AGENCY
    ageRange,          // optional age filter
    hasTrainings,      // require trained candidates
    onlyUnemployed     // only currently unemployed executives
}

→ Creates an offer in ru.FOUND status
```

### 2. Accelerate Search (SimBoost)
```
PATCH /api/v2/companies/executives/my-offers/{id}

Payload: { accelerated: true }

→ Spends SimBoosts to rush the search
```

### 3. Extend Formal Offer
```
PATCH /api/v2/companies/executives/my-offers/{id}

Payload: { executive: true, salary }

→ salary must be: 0.9 × expectedSalary ≤ salary ≤ 10 × expectedSalary
→ Status changes to ru.STANDING
→ Employer receives hostile offer notification
```

### 4. Research Poacher (Employer's Company)
```
PUT /api/v2/companies/executives/my-offers/{id}

→ Costs: $K = 5 SimBoosts (purchaseDriver: Wo.EXECUTIVE_RESEARCH_EMPLOYER)
→ Reveals employer company details to help poacher decide
```

### 5. Dismiss Offer
```
DELETE /api/v2/companies/executives/my-offers/{id}
```

### 6. Refresh / Re-roll Offer
```
POST /api/v2/companies/executives/my-offers/{id}
→ Gets new candidates for stale offers
```

---

## Hostile Offer Lifecycle (Employer Side)

### Receiving a Hostile Offer
When a poacher extends an offer to your executive, you receive a notification via:
```
GET /api/v3/companies/executives/hostile-offers/
→ Returns { offers: [...] }
```

Each hostile offer contains:
- `id` — offer ID
- `executiveId` — targeted executive
- `expectedSalary` — salary the poacher is offering
- `status` — `ru.STANDING` or `ru.FOUND` (FOUND = candidate found but not yet formally offered)
- `extended` — timestamp when the formal offer was extended
- `researchEmployer` — object with poacher company details (if researched)

### Counter-Offer (Raise Salary)
The employer can counter by raising the executive's salary:

**Threshold**: Must raise to at least **75%** of the expected salary.

```
requiredSalary = Math.ceil(expectedSalary × $or / 100)
               = Math.ceil(expectedSalary × 75 / 100)
               = Math.ceil(expectedSalary × 0.75)
```

If `executive.salary < requiredSalary`, the counter-offer button appears.

```
PATCH /api/v4/executives/{executiveId}
Payload: { salary: requiredSalary }

Then: DELETE /api/v3/companies/executives/hostile-offers/{offerId}
```

### Let Go To Competitor
Accept the poaching — the executive leaves your company.

```
PATCH /api/v3/companies/executives/hostile-offers/{offerId}

→ Returns { moneyDelta, stayed }
→ If stayed=false: executive leaves, employer receives moneyDelta compensation
→ If stayed=true: executive chose to stay despite employer not countering
```

### Reject Offer (without counter)
```
DELETE /api/v3/companies/executives/hostile-offers/{offerId}
→ Executive stays but may leave in future
```

### Research Employer (Employer's Side)
```
PUT /api/v3/companies/executives/hostile-offers/{offerId}

→ Costs SimBoosts
→ Reveals researchEmployer data about the poacher
```

**Research Results** (`researchEmployer` object):
| Field | Description |
|-------|-------------|
| `marketSalary` | Market-rate salary for this position |
| `poacherCompanyValue` | Poacher's company valuation |
| `poacherAverageSalary` | Poacher's average executive salary |
| `poacherFiredEmployeesCount` | How many execs poacher has fired |
| `poacherAverageYearsSpendAtCompany` | Average tenure at poacher's company |

---

## Severance / Compensation Formula

When an executive leaves (either "let go" or poached), the compensation is:

```
USr(expectedSalary, totalDaysActive) = Math.floor(expectedSalary × totalDaysActive × Uor / (2 × 100))
                                      = Math.floor(expectedSalary × totalDaysActive × 1 / 200)
                                      = Math.floor(expectedSalary × totalDaysActive / 200)
```

Where:
- `totalDaysActive` = total days the executive worked at current employer
- `Uor = 1`
- Returns 0 if `totalDaysActive < 2`

---

## Key Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `$or` | 75 | Counter-offer threshold: employer must match ≥75% of expected salary |
| `$At` | 86400 | Hostile offer cooldown: 24 hours (in seconds) |
| `$K` | 5 | SimBoost cost to research employer |
| `KO` | 30000 | Training cost per training session ($30,000) |
| `Uor` | 1 | Severance formula numerator |
| `ije` | 3 | Dismissal severance days (`executive.salary × 3`) |
| `mfe` | 3 | Retirement notice period: 3 days |
| `BAt` | 6 | Weeks in training history window (6 weeks) |
| `y$` | 36000 | 10 hours (executive-related timing) |
| `b$` | 10800 | 3 hours (executive-related timing) |
| `_$` | 97200 | 27 hours (executive-related timing) |

---

## Cooldown Mechanics

1. **Poaching Cooldown (4 days)**: Agencies will not target executives that recently accepted or refused an offer.  
   Source: changelog entry `I6i.js:7959`

2. **Offer Extension Deadline**: After a formal offer is extended, the employer has a deadline to respond.  
   - `deadline = Date.parse(hostileOffer.extended) + $At × 1000`  
   - `$At = 86400` → deadline is 24 hours after offer extension  
   - Warning appears when less than 1 hour remains

3. **Targeted Before Cooldown**: An executive may receive back-to-back offers if they were already targeted before the first offer was accepted/rejected.

---

## Executive Seniority (`e7` enum)

| Level | Description |
|-------|-------------|
| `e7.JUNIOR` | Junior executive |
| `e7.EXPERIENCED` | Experienced executive |
| `e7.SENIOR` | Senior executive |

---

## Notification Types (`vn` enum)

| Notification | Meaning |
|-------------|---------|
| `EXECUTIVE_OFFER` | Poacher extended an offer to your executive |
| `EXECUTIVE_ACCEPTED_OFFER` | Your executive accepted the poacher's offer |
| `EXECUTIVE_WANTED_TO_ACCEPT_OFFER` | Executive wanted to accept but your company was low on cash |
| `EXECUTIVE_DECLINED_OFFER` | Your executive declined the poacher's offer |
| `EXECUTIVE_STAYED` | Executive stayed after you let them go |
| `AGENCY_FOUND_EXECUTIVE` | Agency found a candidate |
| `AGENCY_FAILED` | Agency failed to find candidates |
| `EXECUTIVE_TRAINING_FINISHED` | Executive completed training |
| `EXECUTIVE_WILL_RETIRE` | Executive plans to retire |
| `EXECUTIVE_RETIRED` | Executive has retired |
| `EXECUTIVE_BURNOUT` | Executive burnout |
| `EXECUTIVES_STRIKE` | Executives on strike |

---

## API Endpoints

### Poacher Side (v2)
| Method | Endpoint | Action |
|--------|----------|--------|
| `GET` | `/api/v2/companies/executives/my-offers/` | List my offers |
| `POST` | `/api/v2/companies/executives/my-offers/` | Start new search |
| `PATCH` | `/api/v2/companies/executives/my-offers/{id}/` | Update offer (salary / accelerate) |
| `PUT` | `/api/v2/companies/executives/my-offers/{id}/` | Research employer |
| `POST` | `/api/v2/companies/executives/my-offers/{id}/` | Refresh/re-roll |
| `DELETE` | `/api/v2/companies/executives/my-offers/{id}/` | Dismiss offer |

### Employer Side (v3)
| Method | Endpoint | Action |
|--------|----------|--------|
| `GET` | `/api/v3/companies/executives/hostile-offers/` | List hostile offers |
| `PATCH` | `/api/v3/companies/executives/hostile-offers/{id}/` | Let go to competitor |
| `PUT` | `/api/v3/companies/executives/hostile-offers/{id}/` | Research employer |
| `DELETE` | `/api/v3/companies/executives/hostile-offers/{id}/` | Reject offer |

### Executive Management (v4)
| Method | Endpoint | Action |
|--------|----------|--------|
| `GET` | `/api/v4/executives/{id}/` | Get executive details |
| `PATCH` | `/api/v4/executives/{id}/` | Update (salary, position, retire, strike) |
| `DELETE` | `/api/v4/executives/{id}/` | Dismiss executive |
| `POST` | `/api/v4/executives/{companyId}/` | Hire new executive |
| `POST` | `/api/v4/executives/trainings/{execId}/` | Start training |
| `PATCH` | `/api/v4/executives/trainings/{execId}/{trainingId}/` | Rush training |
| `DELETE` | `/api/v4/executives/trainings/{execId}/{trainingId}/` | Cancel training |

---

## Flow Diagram

```
POACHER SIDE                          EMPLOYER SIDE
───────────                          ─────────────
Select agency + position
        │
        ▼
POST my-offers ──────► ru.FOUND
        │
        ▼
Extend offer (salary) ─────────────► ru.STANDING ───► Employer notified
        │                                               │
        │                              ┌────────────────┼────────────────┐
        │                              ▼                ▼                ▼
        │                         Counter-Offer    Let Go         Reject
        │                         (raise salary   (accept)       (decline)
        │                          to ≥75% of
        │                          expected)
        │                              │                │                │
        │                              ▼                ▼                ▼
        │                         Exec stays       Exec leaves      Exec stays
        │                         (offer           (employer        (but may
        │                          rejected)        gets comp)       leave later)
        │                              │
        ▼                              ▼
   ┌─────────┐                 4-day cooldown
   │ Outcome │                 before re-target
   └─────────┘
```

---

## Source Files

| File | Content |
|------|---------|
| `chunk_VRt.js` | API functions for executive offers (FQr, jQr, GQr, KQr, XQr, QQr, JQr, eJr, tJr) |
| `chunk_Thi.js` | Hostile offer UI component (`sgi`), executive search UI (`$hi`) |
| `chunk_Tfi.js` | Executive slot UI component (`wzt`, `Tft`) |
| `chunk_cJr.js` | `cl()` hook — all executive/offer state management |
| `chunk_s5t.js` | `USr()` severance formula |
| `chunk_ugi.js` | Executive management page |
| `chunk_Era.js` | Notification rendering (`vn` enum usage) |
| `entry.js` | All game constants (`$or`, `$At`, `$K`, `KO`, `Joe`, `usr`, `ru`, `Om`, `vn`, `e7`) |
