---
name: decompile-evidence-reuse
description: Reuse verified SimCompanies frontend/decompile evidence before reading minified bundles; only perform narrow, anchored decompilation when existing evidence is insufficient, then persist new findings for future agents.
---

# Decompile evidence reuse

Use this skill for any task that depends on the original SimCompanies frontend contract, bundled/minified JavaScript, frontend-consumed response fields, hidden formulas, status enums, translation strings, or other decompile-derived behavior.

This skill exists to prevent repeated full-bundle investigation. Frontend decompilation is an evidence fallback, not the default first step.

Related tracking issue: #162.

## Mandatory rule

Before opening or searching a minified frontend bundle, first determine whether the needed fact has already been established elsewhere in the repository or issue history.

Do not read a large bundle simply to "understand the frontend" or to reconfirm a contract that is already backed by sufficient evidence.

## Evidence reuse order

Search narrowly in this order:

1. The exact GitHub Issue / failing regression / DOM reproducer for the current task.
2. `server/data/decompile/` and any compatibility/decompile registry under it.
3. `server/game-data/` for already-verified canonical formulas, resource/building capabilities, seasonal data, or static game rules.
4. Existing `tests/verify-issue-*`, E2E reproducers, fixtures, and contract assertions related to the feature.
5. Existing compatibility DTOs/routes and nearby comments that cite verified frontend/HAR behavior.
6. Relevant prior GitHub Issues/commits when they contain concrete contract evidence.
7. HAR / Network captures or other preserved runtime evidence.
8. Only then: targeted search inside the original frontend bundle.

If steps 1-7 already establish the field names, nesting, type, formula, enum, or state transition needed for the fix, stop there. Do not enter the minified bundle merely for reassurance.

## Define the missing fact first

Before any new decompilation, write down the exact unresolved question in one sentence. Examples:

```text
Does GET /api/v2/companies/buildings/:id/abundance/ need buildingId in the response?
Which field does the chat message renderer read for message body text?
Which executive skill controls administration-overhead reduction?
What state value causes the retail building UI to render an active sale instead of construction?
```

If the unresolved question cannot be stated narrowly, the investigation scope is still too broad. Return to `evidence-first-investigation` and reduce the working set.

## Targeted decompilation only

When existing evidence is insufficient, enter the bundle using one or more concrete anchors:

- exact endpoint path or a distinctive path fragment;
- response/request field name;
- visible translation string;
- reducer/action/thunk symbol already observed in a stack trace;
- component text shown in the DOM;
- resource/building numeric id;
- known function call or error message;
- nearby symbol from an already-located code path.

Allowed pattern:

```text
known UI action
→ known request/field/string
→ targeted rg/search in bundle
→ inspect the smallest surrounding expression
→ derive one contract fact
→ cross-check with runtime/test evidence where possible
→ stop
```

Disallowed pattern:

```text
open the entire minified bundle
→ scroll/read large regions
→ map unrelated modules
→ "understand architecture"
→ eventually return to the original bug
```

Do not expand from one feature into adjacent subsystems unless a concrete dependency forces the expansion.

## Evidence quality

Treat frontend consumption as evidence of the minimum shape the backend must provide, not automatically as proof of all domain semantics.

Prefer corroboration when available:

```text
DOM behavior + Network/HAR + frontend consumption + persisted state
```

For formulas or economic rules, prefer verified canonical game data or successful official/runtime behavior over guesses from a single minified expression.

Use confidence labels mentally or in persisted evidence:

- `verified` — supported by runtime/HAR/test plus frontend or canonical source;
- `strong` — directly established by frontend consumption but not yet runtime-cross-checked;
- `tentative` — plausible interpretation that still requires verification;
- `stale/contradicted` — conflicts with newer observed behavior and must not be reused as authoritative.

Never silently overwrite conflicting evidence. Record the conflict and re-verify.

## Persist newly discovered knowledge

Any new contract fact that required meaningful bundle/HAR investigation must be left behind in a reusable form so the next Agent does not repeat the work.

Choose the destination based on what was learned:

### Static executable game rule/data

Use `server/game-data/` when the finding is canonical game data consumed by backend logic, such as:

- building/resource capability tables;
- verified static costs;
- product mappings;
- formulas/constants that are authoritative backend rules;
- seasonal/static configuration.

Do not duplicate the same executable rule in a decompile registry.

### Compatibility / provenance evidence

Use `server/data/decompile/registry/` when present (Issue #162), or the nearest existing decompile evidence location, for facts such as:

- endpoint + method;
- frontend field access;
- response nesting/type requirements;
- request payload names;
- reducer/thunk/component consumption;
- bundle symbol/string/path used as the source;
- linked Issue/test/HAR evidence;
- confidence/staleness metadata.

A useful evidence record should answer:

```text
feature
what contract fact was learned
where it came from
how confident we are
which Issue/test relies on it
```

Do not save giant copied minified fragments. Save the conclusion and a precise locator/source reference.

## Working with compatibility-api

When an API/frontend contract task is active, load both:

```text
evidence-first-investigation
compatibility-api
decompile-evidence-reuse
```

`compatibility-api` defines how to reconstruct and verify the contract.
`decompile-evidence-reuse` controls whether a new bundle investigation is necessary and how to preserve its output.

The intended sequence is:

```text
DOM/Issue evidence
→ reuse existing decompile knowledge
→ identify only the missing contract fact
→ targeted decompilation if required
→ implementation
→ regression
→ DOM replay
→ persist any new evidence
```

## Stop conditions

Stop reading frontend code as soon as the current unresolved fact is established with enough evidence to implement and verify the fix.

Do not continue decompiling unrelated code because the bundle is already open.

Do not spend token budget converting minified code into a broad human-readable reconstruction unless the current Issue explicitly requires that deliverable.

## Completion checklist

Before completing a compatibility/decompile-backed task, verify:

- [ ] Existing decompile/game-data/test/Issue evidence was searched before the bundle.
- [ ] New decompilation, if any, started from a concrete anchor.
- [ ] Only the smallest relevant bundle region was inspected.
- [ ] No already-established contract was re-derived without a conflict reason.
- [ ] The implementation is backed by evidence rather than guessed fields.
- [ ] New reusable findings were persisted in canonical game-data or decompile evidence storage.
- [ ] Conflicting/stale evidence was marked and re-verified rather than silently replaced.
- [ ] Regression and DOM verification still validate actual player-visible behavior.
