---
name: simcompanies-e2e
description: Maintain and playtest the SimCompanies original frontend against the private backend with real local Chromium, visible DOM actions, and state-changing evidence.
---

# SimCompanies private-server E2E

Use this skill when changing or validating the original SimCompanies frontend against this repository's private backend.

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

Explore a complete user-visible flow manually first. Record the state transition and evidence, fix the backend route/service/schema root cause, then replay the same flow after a refresh. Only after the manual flow works should it become `tests/e2e/*.spec.ts`.

Playwright regression tests must use DOM locators (`getByRole`, `getByLabel`, `getByText`, or `locator`) for all business actions. Do not use `page.request`, direct fetches, `page.evaluate`, direct database setup, or API calls to manufacture money, inventory, buildings, production, market, stars, or executive state.

When a route is missing, identify the exact frontend contract from the observed request and response usage. Implement a typed compatibility route and real game/database mutation. Never hide an unimplemented route behind a generic `[]`, `{}`, or `{success:true}` response.

## Release evidence

For each repaired flow, preserve at least one screenshot before and after the meaningful state change. Check the visible result, refresh persistence, local request status/schema, response semantics, and console/page-error health. Run:

```sh
npm run e2e
```

The release gate is manual exploratory E2E plus the DOM regression, not an API-only test. Report tested buttons/pages, remaining unimplemented APIs, incomplete pages, manual and automated coverage, and the five most serious remaining player-visible problems.
