---
name: simcompanies-e2e
description: Maintain and playtest the SimCompanies original frontend against the private backend with real local Chromium, visible DOM actions, state-changing evidence, and root-cause handoff to the project repair skills.
---

# SimCompanies private-server E2E

Use this skill when changing or validating the original SimCompanies frontend against this repository's private backend. For broad project work, start with `simcompanies-private`. When exploration exposes a missing/schema-broken API, use `compatibility-api` and `missing-api-recorder`. For money, SimBoosts, inventory, rewards, ownership, or persisted progression, also apply `economy-integrity`.

## Test boundary

The first pass for a feature is exploratory testing in a real local Chromium-compatible browser. Use the visible page like a player: navigation, links, buttons, tabs, dropdowns, dialogs, forms, keyboard input, and selects. Every business action must be created through a visible DOM action and every expected result must be checked in visible DOM.

Network, console, page errors, database inspection, and response bodies are diagnostics only. They may explain a failure, but they must never create test state. Do not call a business API, seed a database, inject JavaScript, or edit cookies/localStorage to bypass a UI flow.

Treat a successful HTTP status as insufficient. A flow fails when the response shape is wrong, a visible value does not change, a list is falsely empty, loading never ends, a refresh loses state, or the browser reports a fatal application error.

## Local runner

The active checkout and browser runtime are kept outside the managed scratch directory:

```sh
cd /opt/phantom-backend-7x
npm run e2e:browser
E2E_BROWSER_PATH=/opt/phantom-browsers/chrome-headless-shell-linux64/chrome-headless-shell npm run e2e
```

`scripts/e2e/find-browser.ts` checks an explicit executable, project Playwright/Puppeteer caches, `/opt/phantom-browsers`, and system browser locations. If the Linux VM has no browser, use a self-contained browser runtime, a browser-enabled OCI container, or a controlled CDP Chromium process. Do not switch to a cloud browser or replace E2E with API tests.

`playwright.config.ts` starts an isolated database under `/opt/phantom-e2e-runs`. The runner stores failure screenshots, traces, video, and an attached `browser-diagnostics.json` containing console errors, page errors, failed requests, request payloads, statuses, and local API response bodies.

## Exploration to regression

Explore a complete user-visible flow manually first. Model each step as:

```text
UI State → User Action → Network Request → Response → New UI State
```

Do not count a page as covered merely because it rendered. Exercise meaningful visible buttons, tabs, dropdowns, modals and forms, then follow newly reachable states.

When a failure appears, record the triggering page/action and Network/Console evidence. If it is a missing/fake API or response-contract problem, follow `missing-api-recorder` and `compatibility-api`. If the flow changes money, SimBoosts, inventory, orders, rewards, buildings or other durable player state, apply `economy-integrity` before declaring it fixed.

Fix the backend route/service/schema root cause, then replay the same visible flow after a refresh. Only after the manual flow works should it become `tests/e2e/*.spec.ts`.

Playwright regression tests must use DOM locators (`getByRole`, `getByLabel`, `getByText`, or `locator`) for all business actions. Do not use `page.request`, direct fetches, `page.evaluate`, direct database setup, or API calls to manufacture money, inventory, buildings, production, market, stars, or executive state.

When a route is missing, identify the exact frontend contract from the observed request and response usage. Implement a typed compatibility route and real game/database mutation. Never hide an unimplemented route behind a generic `[]`, `{}`, or `{success:true}` response.

## Evidence and issue loop

For a reproducible player-visible defect, preserve relevant evidence and create/update a focused Issue rather than burying multiple unrelated defects in one checkpoint. Then follow:

```text
Explore → Issue → Root Cause → Fix → Manual Replay → Refresh Check → Regression → Commit → Continue Explore
```

Do not stop exploration merely because the originally requested Issue is fixed; continue into the next reachable state when the current environment permits.

## Release evidence

For each repaired flow, preserve at least one screenshot before and after the meaningful state change when useful. Check the visible result, refresh persistence, local request status/schema, response semantics, and console/page-error health. Run:

```sh
npm run e2e
```

The release gate is manual exploratory E2E plus the DOM regression, not an API-only test. Report tested buttons/pages, remaining unimplemented APIs, incomplete pages, manual and automated coverage, and the five most serious remaining player-visible problems.
