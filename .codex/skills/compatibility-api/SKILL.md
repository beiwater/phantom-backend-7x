---
name: compatibility-api
description: Reconstruct SimCompanies compatibility APIs from real browser Network/HAR evidence and original frontend response consumption without fake fallback data.
---

# Compatibility API reconstruction

Use this skill when a page is blank, loading forever, using a generic fallback, throwing because of response shape, or when an action reaches an incomplete backend route.

## Evidence order

Prefer evidence in this order:

1. Real exploratory browser action from the original/private frontend.
2. Request URL, method, payload, headers relevant to semantics, status and response.
3. Original-site HAR or DevTools Network capture when available and permitted.
4. Original frontend bundle/component consumption of the response.
5. Existing nearby routes and persisted game models.

Do not invent response fields just to silence an exception.

## Trace the contract

For every missing/incomplete endpoint, document:

```text
visible action
→ method + pathname
→ request payload
→ frontend response access pattern
→ expected types/nesting
→ backend route
→ service/game logic
→ tables/state involved
→ mutation/read semantics
→ response schema
→ refresh behavior
```

Frontend use can establish minimum schema requirements. Examples:

```ts
response.orders.map(...)
response.company.money
response.resource.kind
```

These imply container/field types but should be confirmed against HAR/Network or a successful equivalent flow whenever possible.

## Implementation rules

Implement a dedicated compatibility route and real underlying state behavior. Prefer typed game/service functions over route-local hard-coded objects. Preserve exact naming/casing expected by the original client (`simBoosts` vs `simboosts` vs `sim_boosts`, `dbLetter`, `resourceKind`, etc.).

Do not solve missing endpoints with broad matches such as `pathname.includes(...)` unless the contract truly shares behavior. Watch route ordering so generic handlers cannot shadow specific routes.

Never use a generic `/api/*` handler returning `[]`, `{}`, `{success:true}`, fixed balances, fake rankings/news/certificates/orders, or random placeholder data as the final implementation.

## Stateful APIs

For mutations, validate authentication and ownership before touching state. Money, SimBoosts, inventory, production queues, orders, slots and buildings must be updated consistently and persisted. Use a DB transaction when one action spans multiple state changes.

For read APIs, return persisted values rather than hard-coded defaults once the database contains the real field.

## Verification

After implementing the contract:

1. replay the original visible DOM action;
2. inspect the actual response body/schema;
3. verify visible UI state;
4. verify relevant DB/state diagnostically;
5. refresh/relogin and verify persistence;
6. check Console/PageError/failed requests;
7. only then add or update the DOM-only Playwright regression.

Record unresolved or uncertain contracts in the missing API/data pipeline rather than guessing.
