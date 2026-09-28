# Issue repair checkpoint — 2026-09-28

Work is paused at the user's request. Branch: `fix/issue-bubble-sweep`, based on `cdae3af5f99aad6295f9af8432a09675630ba4d3`. This is a saved repair batch, not a claim that every open issue or release gate is complete.

## Changes saved

- Production: consistent rush pricing, extractor quality and abundance handling, actual-output cost basis, research/launch discrimination, queued launch cancellation, and Q12 research cap.
- Buildings and gameplay: size limits, robot demolition lock, canonical retail duration, government fulfillment, achievement queries, executive weighted skills/role codes, and sales-office busy state.
- Finance and scheduler: remaining-principal loan interest, serialized/retryable scheduler execution, maturity settlement, virtual-clock timestamps and catch-up, accounting overhead, and configurable economy rolling.
- Forest Nursery: growth settles into persistent accumulator state before cutting; dedicated collection validates ownership/time/bounds, handles rollback/repeat requests, restores the correct busy category, and persists harvest/cost/experience together. Ordinary production rush/collection cannot bypass this flow.
- Refunds: original cost snapshots now travel through production, construction, robots, contracts and launches. The broad six-path issue remains open pending complete downgrade/uninstall verification.
- Engineering: strict server TypeScript checking, pre-E2E CI typecheck, uniqueness migrations, and automatic backend test discovery with explicit browser/diagnostic exclusions.
- Tests: `tests/support/test-server.ts` owns an independent service, temporary database, readiness and cleanup; account, stock and request helpers replace repeated setup. Existing scenarios were extended wherever practical. `run-backend-suite.ts` also applies that lifecycle to older suites.
- Browser checks use actual visible construction/production/market/Forest controls and verify state changes and refresh persistence. A missed locator is not evidence that a feature is broken.

## Validation at the checkpoint

- `npm run typecheck`: passed (`strict: true`, server source scope).
- `npm run build`: passed.
- `tests/verify-all-routes.ts`, through the shared service helper: 43 passed, 0 failed.
- Full backend gate: 131 suites executed; 127 passed and 4 failed. All of the issue-specific closure regressions and the production/building vertical-slice suite passed.
- Remaining backend failures: `test-architecture-gates` flags raw SQL in scheduler application code; `test-issue-65-simboosts` still expects a flat construction-rush fee (495 expected, 499 actual); `verify-construction-time-mode` sees the runner's 200x speed (3600 expected, 18 actual); `verify-restaurant-lifecycle` reports first-run `rating_before` as 3.78 rather than 0. These are preserved for the next work session, without claiming an unverified cause beyond the observed values.
- `npm run e2e`: 4 passed, 2 failed. Forest growth/cut/reload, fresh-account core economic loop, Encyclopedia/newspaper/finance navigation and production cancellation passed.
- Building-matrix failure: Chromium reported `net::ERR_CACHE_WRITE_FAILURE` while loading the local built JavaScript asset; the shared audit correctly failed the run. This result does not establish a gameplay failure.
- Other core-loop failure: an optional `myreviews.ai` request was aborted and did not match the current audit exception. The business assertions passed before audit finalization, but the test remains failed.
- Focused production/launch/research/cost and finance/scheduler checks passed. The final backend run covers the new construction-rush, size-limit and robot-lock assertions too.

No assertion was relaxed to hide these failures. Browser artifacts remain locally under `test-results/playwright`; that generated directory is not included in the source commit.

## Issues to retain

| Issues | Remaining work |
| --- | --- |
| #9, #13, #59 | Shared audit/observable waits and crawler changes are saved; complete crawler acceptance and the optional-request exception still need verification. Do not infer coverage from an attempted click. |
| #68, #104, #179 | Broad architecture/vertical-slice/application-authority work is incomplete. |
| #178 | Read-only audit found 19 supported registry records whose handlers are still legacy-only, plus equal-priority overlap questions. Runtime legacy dispatch is preserved. |
| #198 | Registry generation/status/counts/CI drift validation remains unfinished. |
| #199 | Encyclopedia has real data improvements, but industry/realm modifier contracts and the non-neutral economy preview gap remain unresolved. |
| #203 | Explicitly deferred generic PA/SimBoost action contracts. |
| #204, #206 | Full royalties and seasonal egg/swaps contracts lack enough verified evidence; existing responses are not considered complete implementations. |
| #205 | API executive history is persisted and tested, but command `/exec fire` bypasses history and the real browser history entry is unverified. |
| #227 | Cost snapshots are implemented, but all six refund paths have not completed the required verification. |

## Issues eligible for closure after upload

The final issue-specific regressions passed for #14, #37, #200, #201, #202, #208–#226, and #228–#235 (32 issues). The unrelated or conflicting gate failures above remain recorded; the whole branch is not a green release. #201 was already fixed in the base commit and was reverified rather than newly implemented here.

The issue comments will link the uploaded checkpoint and their relevant regression suites. Closing these issues records the verified repair on this branch; it does not mean this checkpoint has been merged or is ready for release.


## Resumed batch checkpoint — 2026-09-29

Work is paused again at the user's request. This section supersedes the pending-work status above; the earlier validation remains an honest historical record. No merge or deployment was performed.

### Saved changes

- Finance, scheduler, certificate awards and queued rocket launches now use authoritative application/repository paths. The timetable keeps only lifecycle/trigger wiring; SQL and domain formulas moved out. Legacy exports reuse the same implementations.
- The recursive architecture gate checks exact runtime-import symbols, raw SQL in routes/application/compatibility, domain IO and scheduler size. Remaining restaurant mutation debt is explicit. The newly started restaurant rewrite was withdrawn before saving; it remains future work.
- Read-only finance/certificate/economy queries no longer generate fictional historical records. Existing regression files cover repeated reads and transaction rollback.
- Migration 42 owns remaining runtime-created schema. Fresh bootstrap, repeat migration, rollback and upgrades with partially existing restaurant columns preserve persisted configuration.
- Route parameters distinguish real locale, company and building inputs; equal-specificity ambiguity fails startup. The separate method manifest was removed. Nineteen supported social/audit paths gained explicit registration. CSRF, time/weather and ranking/resource aliases remain compatible. Legacy API dispatch remains, so #178 is open.
- All six refund paths preserve material quantity and the five original cost buckets, including rollback and repeated-cancellation cases. Tests extend existing production/building, robot, contract and launch scenarios.
- Executive command hire/fire now shares the persisted employment-history use cases. API/command/poaching and rollback tests pass; the visible fire/history/reload scenario reaches its business assertions, but portrait-resource failures still fail its complete browser audit.
- Production uses the original calculator's company slider, salary phase, persisted active event and recreation inputs. An unsupported extra cycle bonus/output multiplier no longer changes the ordered quantity. Existing #199 tests cover recession/boom, a 17% event, a 10% slider and cancellation.
- BrowserAudit records unhandled rejections and keeps local request/console errors fatal. Optional external noise is matched narrowly by exact source/request evidence. The executive-history test alone declares the exact own-company royalties 501/SOURCE_CONTRACT_BLOCKED dependency; this is reported, not treated as an implemented royalty feature.
- The smart/BFS crawlers use visible browser clicks, observable transitions, separate discovered/exercised/failed/unverified records and isolated shared test setup. Complete crawler acceptance is still unverified.
- Original-source egg evidence now records the 1/72 hourly base rate, 1/720 per Spring Market level, rarity weights and reciprocal-proposal acceptance schema. Generation/claim/expiration/error rules remain incomplete. The user's requirement is to continue original-contract research, not invent private rules.

### Validation

- Typecheck and production build: passed.
- Shared isolated all-route probe: 43 passed, 0 failed.
- Route-registry/ownership, auth 401/403 and method 405 checks: passed; startup reports 63 deterministically ordered overlaps and zero equal-specificity conflicts.
- Final backend suite: 132 suites passed, 0 failed, using isolated services and temporary databases.
- Full normal-security Playwright run: 6 passed, 4 failed (10 tests). The three audit negative regressions pass. Remaining failures involve blocked external optional resources, missing local executive portrait assets, a local bundle cache-write failure and a browser Target crashed error. These failures were preserved rather than filtered out.
- A separate executive-history run passed its visible fire/history/reload assertions and reported zero unhandled audit errors. Its declared royalties dependency produced three exact 501 responses and three paired rejection events (six ignored entries); #204 remains unimplemented. The full run still failed on seven portrait paths with 22 local 404 console errors, so #205 stays open.
- The one permitted isolated private-core retry still failed on a MyReviews ERR_ABORTED request from /zh-cn/ and its paired CanceledError. The existing sign-in cleanup exception was not expanded to hide these two audit errors.
- Browser traces, diagnostic JSON and screenshots stay in the local generated test-results directory. Whole-branch release E2E is not green.

### Closure and remaining work

After upload, #9 (strict browser error gate), #179 (finance/executives/scheduler application authority) and #227 (six refund cost paths) are eligible for closure based on their scoped acceptance evidence. A closure records this repair branch, not a merge or a green release.

Keep #13, #59, #68, #104, #178, #198, #199, #203, #204, #205 and #206 open. The route total remains above #104's 3,000-line target; restaurant is still a legacy engine, and generated coverage/CI drift reporting is unfinished. #199 still needs full non-neutral DOM parity and modifier contracts; #205 still needs a clean complete browser audit. PA/general SimBoost actions, royalties and full egg lifecycle require more original evidence.
