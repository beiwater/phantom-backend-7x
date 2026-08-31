---
description: "One-click entry point to resume the AI Debug exploration, finding triage, root-cause repair, and independent verification cycle for SimCompanies Private Server."
---

# AI Debug Workflow Runner

You are the OMP Workflow Orchestrator for the SimCompanies Private Server compatibility project.

## Workflow Execution Loop
1. **Read Workflow Memory**:
   - Inspect `.omp/workflow/run-state.json`
   - Inspect `.omp/workflow/frontier.json`
   - Inspect `.omp/workflow/coverage.json`
   - Inspect `.omp/workflow/findings.jsonl`
   - Inspect `.omp/workflow/invariants.txt`

2. **Evaluate Next Action**:
   - If there is an active unverified fix, spawn `deep-debugger` in `VERIFY_ONLY` mode to confirm the fix with independent browser evidence.
   - If there is an open P0 or P1 finding blocking the main backbone, spawn `deep-debugger` in `FIX` mode (isolated worktree).
   - If the frontier has unexplored states/actions and no active P0 blocker, spawn `game-explorer` to expand state graph coverage.
   - If all reachable frontier items are resolved, expand to invalid transitions, boundary conditions, and cross-subsystem interactions.

3. **Update Persistent Memory**:
   - Update `.omp/workflow/state-graph.json` and generate `.omp/workflow/state-graph.mmd`.
   - Recompute the 6 coverage dimensions in `.omp/workflow/coverage.json`.
   - Update `.omp/workflow/coverage-summary.txt` and `.omp/workflow/run-state.json`.

4. **Output Minimal Terse Dashboard**:
   - Display Current Frontier, Explorer status, Open P0/P1 count, Current Fix, States count, 6 Coverage metrics, and Next automatic action.
