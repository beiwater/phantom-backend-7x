---
name: evidence-first-investigation
description: "Evidence-first, issue-first investigation discipline for coding agents. Prevents repository-wide reading before action by enforcing a small working set, targeted search, explicit investigation budgets, progressive scope expansion, and early hypothesis testing."
---

# Evidence-First Investigation Skill

## 1. Purpose
Use this skill whenever implementing, debugging, or verifying a specific issue or user-visible behavior.

The goal is to prevent **repository-first investigation**: reading large parts of the codebase merely to feel informed before testing a concrete hypothesis. Start from evidence, build the smallest relevant working set, act, and expand only when evidence requires it.

This skill complements `deep-root-cause-debugging`: root-cause depth is required, but breadth must remain controlled.

## 2. Primary Rule: Issue First, Repository Second
Do **not** read the entire repository before making changes.

Start from the most specific available evidence:
1. Exact Issue / requested behavior.
2. Failing test, stack trace, browser observation, Network/HAR evidence, or console error.
3. Route, function, symbol, resource name, or persistence record implicated by that evidence.
4. Direct callers/callees and the smallest relevant test surface.

Build a **minimal working set** around that chain. The rest of the repository is out of scope until a concrete dependency or contradiction requires expansion.

## 3. Initial Investigation Budget
For a normal single-issue task, the initial investigation phase is limited to:

- **Maximum 8 files opened/read in detail.**
- **Maximum 3 dependency hops** from the first implicated implementation point.
- **Maximum 2 repository-wide searches** before forming the first concrete hypothesis.

Targeted searches such as `rg "symbolName"`, route names, error text, endpoint paths, table names, or exact UI strings are preferred over browsing directories.

When the budget is reached, STOP broad investigation and state internally:
- observed evidence,
- current root-cause hypothesis,
- expected invariant,
- smallest test or patch that can falsify/confirm the hypothesis.

Then test or patch the hypothesis.

The budget may be expanded only when new evidence demonstrates that the current working set is insufficient.

## 4. Search-First, Read-Second
Prefer locating exact symbols and behavior before opening files.

Good:
```text
Issue: restaurant revenue is inflated
-> search calculateRevenue / served / restaurant route
-> open the matching route + service + direct helper + focused test
-> form hypothesis
-> test / patch
```

Bad:
```text
Read every file in server/
-> read every service
-> read all repositories
-> read all tests
-> "understand architecture"
-> eventually return to the original bug
```

Rules:
- Never enumerate and read every file in a directory merely to understand architecture.
- Never recursively inspect unrelated modules as a default first step.
- Do not re-read files already understood unless new evidence makes the earlier assumption questionable.
- Read only the surrounding code required to understand the active call/data flow; do not consume an entire large file when a focused section is sufficient.

## 5. Progressive Scope Frontier
Maintain three conceptual scopes while working:

### IN SCOPE
- Current issue or requested behavior.
- Reproduction/evidence.
- Current call chain and state mutation path.
- Direct persistence/schema involved.
- Focused unit/contract/E2E regression for that behavior.

### CONDITIONAL
Open only when current evidence points there:
- Direct dependencies and shared helpers.
- Authentication/authorization used by the active path.
- Compatibility adapter consumed by the active path.
- Shared transaction or event infrastructure implicated by the failure.

### OUT OF SCOPE
Unless separately requested or proven necessary:
- Unrelated gameplay modules.
- General architecture cleanup.
- Opportunistic refactors.
- Other Issues discovered while debugging.
- Whole-repository review.

If an unrelated bug is discovered, record/report it as a separate candidate finding and continue the current task.

## 6. Mandatory Action Threshold
Broad investigation must stop once all three are known:

1. **Affected behavior** — what is observably wrong.
2. **Likely implementation location** — where the behavior is controlled.
3. **Concrete hypothesis** — why that implementation produces the wrong result.

At that point, perform the smallest meaningful action that can validate the hypothesis:
- run a focused test,
- reproduce the exact path,
- inspect one relevant persisted record,
- add a temporary diagnostic when appropriate,
- or implement the minimal fix and run the regression.

Do not continue reading simply to increase confidence without producing new discriminating evidence.

## 7. Expansion Criteria
Expand beyond the initial working set only if at least one condition is true:

- The expected symbol/route does not control the observed behavior.
- A focused test disproves the current hypothesis.
- Data crosses a boundary not yet inspected.
- A shared helper demonstrably changes the relevant invariant.
- The persisted state contradicts the application-layer result.
- The user explicitly requested an architecture-wide audit or repository-wide review.

When expanding, add the **next smallest dependency**, not an entire subsystem.

## 8. Fix Discipline
Once root cause is identified:

```text
Evidence
-> minimal working set
-> hypothesis
-> focused verification
-> minimal root-cause patch
-> focused regression
-> user-visible / persistence verification when applicable
-> atomic commit
```

Do not mix investigation-driven bug fixes with unrelated cleanup. Do not refactor adjacent code just because it looks imperfect.

## 9. Anti-Patterns
The following behaviors are prohibited for ordinary issue work:

- "I will first understand the whole repository."
- Reading all services/routes/tests before touching the implicated path.
- Architecture tourism with no evidence connecting it to the issue.
- Opening dozens of files before forming a falsifiable hypothesis.
- Repeatedly searching for more context after the action threshold has been met.
- Treating token consumption or repository coverage as evidence of correctness.
- Expanding scope because another module is interesting rather than causally relevant.

## 10. Exception: Explicit Broad Reviews
If the task itself is repository-wide — e.g. architecture audit, security audit, dependency migration, global API inventory, or cross-cutting refactor — broad reading may be necessary.

Even then, divide the repository into explicit bounded worksets and produce findings incrementally. Do not silently turn a narrow bug fix into a repository-wide review.
