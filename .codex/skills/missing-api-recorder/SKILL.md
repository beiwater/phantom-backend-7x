---
name: missing-api-recorder
description: Capture, classify, aggregate, and report missing/fake API responses, schema mismatches, browser symptoms, and persistence failures discovered during real exploratory play.
---

# Missing API / Data recorder

Use this skill while exploring the original frontend against the private backend, especially for #58.

The recorder is evidence infrastructure, not a repair shortcut.

## Target files

Prefer the project convention:

```text
data/missing-api.ndjson
data/schema-observations.json
scripts/debug/record-missing-api.ts
scripts/debug/report-missing-api.ts
```

Reuse existing Chromium/CDP/Playwright diagnostic hooks where possible. Do not build a second browser framework if the existing E2E diagnostics can emit the required observations.

## Observation model

Capture enough context to reproduce the failure:

```json
{
  "time": "ISO timestamp",
  "page": "/company/...",
  "action": "click upgrade",
  "method": "GET",
  "pathname": "/api/v2/...",
  "requestBody": {},
  "status": 200,
  "responseSample": [],
  "problem": "fallback-empty-array",
  "frontendEffect": "infinite-loading",
  "consoleError": "...",
  "expectedShapeEvidence": "bundle/HAR/network"
}
```

Redact or omit cookies, Authorization, session tokens, passwords, payment secrets and unrelated personal data.

## Flagging rules

Automatically surface at least:

- 404 and 5xx API responses;
- requests handled by a known generic fallback;
- suspicious `200 []`, `200 {}` and empty success objects;
- missing required fields or wrong primitive/container types;
- Console/PageError with `undefined`, `NaN`, iterator/map/property errors;
- successful request followed by blank UI or infinite loading;
- visible action with no corresponding expected state transition;
- money, SimBoosts, inventory, building or production state not changing as expected;
- state that appears successful but disappears after refresh/relogin.

Do not flag every legitimate empty collection as a bug. Correlate the response with frontend semantics and the current user state.

## Schema observations

Record response access patterns from the original frontend as evidence, for example `response.orders.map`, `response.company.money`, or `response.resource.kind`. Treat these as minimum contract observations, not permission to fabricate the rest of the schema.

Where possible, confirm inferred structure with original HAR/DevTools Network or a known working equivalent flow.

## Report generation

Aggregate repeated observations by normalized method + route + problem. Report:

- trigger pages/actions;
- occurrence count;
- representative status and response sample;
- frontend symptom;
- schema evidence;
- whether a generic fallback was involved;
- likely route/game file when confidently discoverable;
- existing GitHub Issue if already tracked.

Prefer deterministic JSON plus a concise Markdown repair queue so agents can compare runs and avoid duplicate Issues.

## Completion loop

A recorder finding is not resolved when the log entry disappears. Resolution requires:

```text
observation → focused Issue → real compatibility implementation → manual DOM replay → refresh persistence → regression
```

Never auto-repair findings by inserting `[]`, `{}`, `{success:true}`, hard-coded balances, fake rankings/news/certificates/orders, or large mocks.
