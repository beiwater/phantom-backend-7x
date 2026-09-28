import puppeteer, { type Page } from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { attachBrowserAudit, waitForUiStable, waitForUiTransition } from './e2e/support/browser-audit.ts';
import { verifyCrawlerAccountPersists } from './e2e/support/crawler-evidence.ts';
import { withTestServer } from './support/test-server.ts';

function getFormattedTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

interface ActionCandidate {
  id: string;
  tag: string;
  role: string;
  widgetType: 'tab' | 'modal-control' | 'form-action' | 'filter' | 'navigation-link' | 'generic-button';
  text: string;
  href: string | null;
  domIndex: number;
  expanded: string | null;
  selected: string | null;
  pressed: string | null;
  baseScore: number;
  clickCount: number;
}

interface StateNode {
  fingerprint: string;
  url: string;
  title: string;
  activeModal: string | null;
  actions: ActionCandidate[];
  visitCount: number;
}

// Scientific DOM Integrity & White Screen Check
async function assertDOMIntegrity(page: Page, stateName: string) {
  const check = await page.evaluate(() => {
    const root = document.getElementById('root');
    const bodyText = document.body.innerText ? document.body.innerText.trim() : '';
    const visibleElements = Array.from(document.querySelectorAll('div, a, button, h1, h2, h3, table, img')).filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    const crashKeywords = ['An unexpected error occurred', 'Failed to load app', 'Something went wrong', 'Cannot read properties'];
    const foundCrash = crashKeywords.find(k => bodyText.includes(k));

    const nanKeywords = ['$NaN', 'NaN$', 'BoostsNaN', 'BoostNaN', 'Sim BoostsNaN'];
    const foundNaN = nanKeywords.find(k => bodyText.includes(k));

    return {
      rootChildCount: root ? root.children.length : 0,
      textLength: bodyText.length,
      visibleCount: visibleElements.length,
      foundCrash,
      foundNaN,
      title: document.title,
      snippet: bodyText.slice(0, 80).replace(/\s+/g, ' ')
    };
  });

  if (check.rootChildCount === 0 || check.textLength < 5 || check.visibleCount === 0) {
    throw new Error(`[WHITE SCREEN DETECTED] State '${stateName}' is blank! (Visible elements: ${check.visibleCount})`);
  }
  if (check.foundCrash) {
    throw new Error(`[CRASH STATE DETECTED] State '${stateName}' contains crash keyword: '${check.foundCrash}'`);
  }
  if (check.foundNaN) {
    throw new Error(`[NAN CORRUPTION DETECTED] State '${stateName}' contains NaN formatting error: '${check.foundNaN}'`);
  }

  return check;
}

// Smart Heuristic Widget Tree Analyzer
async function analyzeStateAndWidgetTree(page: Page, actionPenaltyMap: Map<string, number>): Promise<StateNode> {
  const rawState = await page.evaluate(() => {
    const url = window.location.pathname;
    const title = document.title;

    // Detect Modal / Dialog Widget
    const modalEl = document.querySelector('.modal-dialog, [role="dialog"], .modal-content');
    const modalTitle = modalEl ? modalEl.querySelector('h1, h2, h3, h4, .modal-title')?.textContent?.trim() || 'Active Modal' : null;

    // Identify Interactive Elements
    const candidates: Array<{
      tag: string;
      role: string;
      text: string;
      classes: string;
      href: string | null;
      domIndex: number;
      expanded: string | null;
      selected: string | null;
      pressed: string | null;
      widgetType: 'tab' | 'modal-control' | 'form-action' | 'filter' | 'navigation-link' | 'generic-button';
      baseScore: number;
    }> = [];

    const elements = Array.from(document.querySelectorAll('button, a[href], [role="tab"], [role="button"], .btn'));

    for (const [domIndex, el] of elements.entries()) {
      const rect = el.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0;
      if (!isVisible) continue;

      const disabled = (el as HTMLButtonElement).disabled;
      if (disabled) continue;

      const tag = el.tagName.toUpperCase();
      const role = el.getAttribute('role') || '';
      const text = el.textContent?.trim().replace(/\s+/g, ' ') || '';
      const classes = el.className || '';
      const href = el.getAttribute('href');

      if (!text && !href && !classes) continue;

      // Skip Destructive or Logout Actions
      if (['登出', 'Sign out', 'Logout', '删除', 'Delete', 'Reset', '全部接受', '仅限必要'].some(d => text.includes(d))) {
        continue;
      }
      if (href && /(?:signout|logout|delete|reset)/i.test(new URL(href, window.location.href).pathname)) continue;

      // Classify Widget Type & Assign Heuristic Base Scores
      let widgetType: 'tab' | 'modal-control' | 'form-action' | 'filter' | 'navigation-link' | 'generic-button' = 'generic-button';
      let baseScore = 20;

      if (modalEl && modalEl.contains(el)) {
        widgetType = 'modal-control';
        baseScore = 45;
      } else if (role === 'tab' || classes.includes('tab') || classes.includes('nav-link')) {
        widgetType = 'tab';
        baseScore = 50;
      } else if (classes.includes('filter') || /^(?:筛选|Q\d{1,2})/.test(text)) {
        widgetType = 'filter';
        baseScore = 35;
      } else if (tag === 'BUTTON' && (text.includes('生产') || text.includes('购买') || text.includes('建设') || text.includes('升级') || text.includes('领取') || text.includes('收取'))) {
        widgetType = 'form-action';
        baseScore = 40;
      } else if (tag === 'A' && href && href.startsWith('/zh-cn/')) {
        widgetType = 'navigation-link';
        baseScore = 25;
      }

      candidates.push({
        tag,
        role,
        text: text.slice(0, 40),
        classes: typeof classes === 'string' ? classes.slice(0, 60) : '',
        href,
        domIndex,
        expanded: el.getAttribute('aria-expanded'),
        selected: el.getAttribute('aria-selected'),
        pressed: el.getAttribute('aria-pressed'),
        widgetType,
        baseScore
      });
    }

    return {
      url,
      title,
      modalTitle,
      candidates
    };
  });

  const fingerprint = `${rawState.url}::modal=${rawState.modalTitle || 'none'}::controls=${rawState.candidates.map(c => `${c.domIndex}:${c.widgetType}:${c.text}:${c.expanded}:${c.selected}:${c.pressed}`).join('|')}`;
  const actions: ActionCandidate[] = rawState.candidates.map(c => {
    const actionId = `${rawState.url}::${c.domIndex}::${c.widgetType}::${c.text || c.href || 'unnamed'}`;
    const clickCount = actionPenaltyMap.get(actionId) || 0;
    return {
      id: actionId,
      tag: c.tag,
      role: c.role,
      widgetType: c.widgetType,
      text: c.text,
      href: c.href,
      domIndex: c.domIndex,
      expanded: c.expanded,
      selected: c.selected,
      pressed: c.pressed,
      baseScore: c.baseScore,
      clickCount
    };
  });

  return {
    fingerprint,
    url: rawState.url,
    title: rawState.title,
    activeModal: rawState.modalTitle,
    actions,
    visitCount: 1
  };
}


async function clickAction(page: Page, target: ActionCandidate): Promise<void> {
  const candidates = await page.$$('button, a[href], [role="tab"], [role="button"], .btn');
  const candidate = candidates[target.domIndex];
  if (!candidate) throw new Error(`Interactive control was not found: ${target.id}`);
  const details = await candidate.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const htmlElement = element as HTMLButtonElement;
    return {
      visible: rect.width > 0 && rect.height > 0,
      disabled: htmlElement.disabled === true,
      tag: element.tagName,
      text: element.textContent?.trim().replace(/\s+/g, ' ') || '',
      href: element.getAttribute('href'),
      expanded: element.getAttribute('aria-expanded'),
      selected: element.getAttribute('aria-selected'),
      pressed: element.getAttribute('aria-pressed'),
    };
  });
  if (!details.visible || details.disabled || details.tag !== target.tag || details.text.slice(0, 40) !== target.text
    || details.href !== target.href || details.expanded !== target.expanded || details.selected !== target.selected || details.pressed !== target.pressed) {
    throw new Error(`Interactive control changed or became unavailable: ${target.id}`);
  }
  await candidate.click();
}
async function clickVisibleButtonContaining(
  page: Page,
  textFragments: string[],
  audit: ReturnType<typeof attachBrowserAudit>,
  action: string,
): Promise<boolean> {
  for (const button of await page.$$('button')) {
    const details = await button.evaluate(element => ({
      text: element.textContent?.trim().replace(/\s+/g, ' ') ?? '',
      visible: element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0,
      disabled: (element as HTMLButtonElement).disabled,
    }));
    if (!details.visible || details.disabled || !textFragments.some(fragment => details.text.includes(fragment))) continue;
    const before = await waitForUiStable(page, { action: `before ${action}` });
    audit.recordAction(action);
    await button.click();
    await waitForUiTransition(page, before, { action });
    return true;
  }
  return false;
}

async function runSmartHeuristicTraversal(baseUrl: string, maxSteps: number = 35) {
  const timestamp = getFormattedTimestamp();
  const roundDir = path.resolve('screenshots', `smart_traversal_${timestamp}`);
  fs.mkdirSync(roundDir, { recursive: true });

  console.log('================================================================');
  console.log(' Starting Smart Heuristic Traversal (智能化 / 启发式遍历引擎)');
  console.log(` Max Steps: ${maxSteps} | Output: ${roundDir}`);
  const browserArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'];
  if (browserArgs.includes('--disable-web-security')) throw new Error('Smart traversal must run with normal browser web security enabled');
  const browser = await puppeteer.launch({
    headless: true,
    args: browserArgs
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const audit = attachBrowserAudit(page);

  // Action & State Penalty Trackers
  const actionPenaltyMap = new Map<string, number>();
  const failedActionIds = new Set<string>();
  const discoveredActionIds = new Set<string>();
  const exercisedActionIds = new Set<string>();
  const unverifiedActionIds = new Set<string>();
  const exercisedActionEvidence: Array<{ id: string; widgetType: ActionCandidate['widgetType']; from: string; to: string; network: ReturnType<typeof audit.snapshot>['network'] }> = [];
  const stateVisitMap = new Map<string, number>();
  const stateGraph = new Map<string, StateNode>();
  let terminalStates = 0;
  let totalStatesDiscovered = 0;
  let totalStateVisits = 0;
  let stepsRun = 0;
  let terminationReason = 'step-budget';
  let setupMutationEvidence: Record<string, unknown> = {};

  try {
    // ----------------------------------------------------
    // Phase 1: Clean Player Authentication Setup
    // ----------------------------------------------------
    console.log('\n[Phase 1] Authenticating clean player session for smart exploration...');
    await page.goto(`${baseUrl}/zh-cn/signup/`, { waitUntil: 'domcontentloaded' });
    const signupPageUrl = page.url();
    await waitForUiStable(page, { action: 'load signup page' });
    await assertDOMIntegrity(page, 'Signup Page');
    await clickVisibleButtonContaining(page, ['全部接受', '仅限必要'], audit, 'dismiss cookie banner');

    const emailFieldsVisible = await page.$('input[type="email"], input[name="email"]');
    if (!emailFieldsVisible && !await clickVisibleButtonContaining(page, ['使用邮箱地址', '邮箱'], audit, 'choose email registration')) {
      throw new Error('[UI_ACTION_FAILED] Signup page did not expose a visible email-registration control');
    }

    const testEmail = `smart_player_${Date.now()}@domain.local`;
    const emailInput = await page.$('input[type="email"], input[name="email"]');
    const passwordInput = await page.$('input[type="password"], input[name="password"]');

    if (!emailInput || !passwordInput) throw new Error('[UI_ACTION_FAILED] Signup form did not expose email and password fields');
    await emailInput.type(testEmail);
    await passwordInput.type('Password123!');
    const beforeRegistration = await waitForUiStable(page, { action: 'before signup submission' });
    audit.recordAction('submit signup form');
    const registrationResponsePromise = page.waitForResponse(response =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v2/auth/email/connect/',
      { timeout: 20_000 },
    );
    await passwordInput.press('Enter');
    const registrationResponse = await registrationResponsePromise;
    if (registrationResponse.status() !== 200) throw new Error(`Signup response returned HTTP ${registrationResponse.status()}`);
    const registrationPayload = await registrationResponse.json() as { status?: string; redirectUrl?: string };
    if (registrationPayload.status !== 'redirect' || !['/zh-cn/create/', '/zh-cn/landscape/'].includes(registrationPayload.redirectUrl ?? '')) {
      throw new Error(`Signup response did not satisfy the redirect contract: ${JSON.stringify(registrationPayload)}`);
    }
    await waitForUiTransition(page, beforeRegistration, { action: 'submit signup form', timeoutMs: 20_000 });

    await page.waitForFunction(() => /\/zh-cn\/(?:create|landscape)\//.test(location.pathname), { timeout: 20_000 });
    await waitForUiStable(page, { action: 'load post-registration company page' });
    let companyCreateEvidence: Record<string, unknown> | null = null;
    if (/\/zh-cn\/create\//.test(page.url())) {
      const companyNameInput = await page.$('input:not([type="password"]):not([type="email"])');
      if (!companyNameInput) throw new Error('[UI_ACTION_FAILED] Company-creation page did not expose its company-name input');
      await companyNameInput.type(`Smart traversal ${Date.now()}`);
      const companyResponsePromise = page.waitForResponse(response =>
        response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/realm-create-company/0/',
        { timeout: 20_000 },
      );
      if (!await clickVisibleButtonContaining(page, ['开始游戏'], audit, 'create company')) {
        throw new Error('[UI_ACTION_FAILED] Company-creation page did not expose the visible start-game button');
      }
      const companyResponse = await companyResponsePromise;
      if (companyResponse.status() !== 200) throw new Error(`Company creation returned HTTP ${companyResponse.status()}`);
      const companyPayload = await companyResponse.json() as { status?: string; redirectUrl?: string; companyId?: number; realmId?: number };
      if (companyPayload.status !== 'redirect' || !Number.isInteger(companyPayload.companyId) || companyPayload.companyId! <= 0) {
        throw new Error(`Company creation response did not satisfy its contract: ${JSON.stringify(companyPayload)}`);
      }
      companyCreateEvidence = {
        method: 'POST', path: '/api/v1/realm-create-company/0/', status: companyResponse.status(), response: companyPayload,
        visibleTransition: { from: '/zh-cn/create/', to: companyPayload.redirectUrl }
      };
    }
    await page.waitForSelector('a[href*="/b/"], #main-menu-dropdown', { visible: true, timeout: 20_000 });
    await waitForUiStable(page, { action: 'load authenticated landscape root' });
    await assertDOMIntegrity(page, 'Landscape Map (Root)');
    const persistence = await verifyCrawlerAccountPersists(page);
    setupMutationEvidence = {
      registration: {
        method: 'POST', path: '/api/v2/auth/email/connect/', status: registrationResponse.status(), response: registrationPayload,
        visibleTransition: { from: signupPageUrl, to: page.url(), displayedBalance: persistence.visibleBeforeRefresh.money }
      },
      companyCreation: companyCreateEvidence,
      persistence,
    };

    // ----------------------------------------------------
    // Phase 2: Smart Heuristic Traversal Loop
    // ----------------------------------------------------
    console.log('\n[Phase 2] Executing Smart Heuristic Decision Loop...');

    for (let step = 1; step <= maxSteps; step++) {
      stepsRun = step;
      // 1. Analyze Current DOM & Widget Tree Structure
      await waitForUiStable(page, { action: `before state discovery at step ${step}` });
      const currentState = await analyzeStateAndWidgetTree(page, actionPenaltyMap);
      for (const action of currentState.actions) {
        discoveredActionIds.add(action.id);
        if (!['navigation-link', 'tab', 'filter'].includes(action.widgetType)) unverifiedActionIds.add(action.id);
      }
      const stateCount = (stateVisitMap.get(currentState.fingerprint) || 0) + 1;
      stateVisitMap.set(currentState.fingerprint, stateCount);

      if (!stateGraph.has(currentState.fingerprint)) {
        stateGraph.set(currentState.fingerprint, currentState);
        totalStatesDiscovered++;
      }
      totalStateVisits++;

      // 2. Score Candidates using Heuristic Penalty Function
      const scoredCandidates = currentState.actions.map(a => {
        const clicks = actionPenaltyMap.get(a.id) || 0;
        const penalty = clicks * 15 + (stateCount > 3 ? (stateCount - 3) * 10 : 0);
        const effectiveScore = Math.max(0, a.baseScore - penalty);
        return {
          action: a,
          clicks,
          penalty,
          effectiveScore
        };
      });

      const eligibleCandidates = scoredCandidates
        .filter(c => ['navigation-link', 'tab', 'filter'].includes(c.action.widgetType)
          && c.effectiveScore > 0 && c.clicks < 3 && !failedActionIds.has(c.action.id))
        .sort((a, b) => b.effectiveScore - a.effectiveScore);

      console.log(`\n--- [STEP ${step}/${maxSteps}] State: "${currentState.fingerprint}" (Visit #${stateCount}) ---`);
      console.log(`  -> Detected ${currentState.actions.length} widget actions (${eligibleCandidates.length} eligible candidates).`);

      if (eligibleCandidates.length === 0) {
        terminalStates++;
        console.log('  -> No verified non-mutating controls remain; backtracking with browser history...');
        const previousUrl = page.url();
        const response = await page.goBack({ waitUntil: 'domcontentloaded', timeout: 5000 });
        if (page.url() === previousUrl) {
          terminationReason = 'browser-history-exhausted';
          break;
        }
        if (!response) console.log('  -> Browser history returned to a same-document UI state.');
        await waitForUiStable(page, { action: 'complete browser history backtrack' });
        continue;
      }

      // Pick top-scoring action
      const chosen = eligibleCandidates[0];
      const targetAction = chosen.action;
      console.log(`  -> Selected Action: [${targetAction.widgetType.toUpperCase()}] "${targetAction.text || targetAction.id}" (Score: ${chosen.effectiveScore}, Prior Clicks: ${chosen.clicks})`);

      try {
        const before = await waitForUiStable(page, { action: `before ${targetAction.id}` });
        const networkOffset = audit.snapshot().network.length;
        audit.recordAction(`click non-mutating ${targetAction.widgetType}: ${targetAction.id}`);
        await clickAction(page, targetAction);
        const after = await waitForUiTransition(page, before, { action: `click ${targetAction.id}` });
        const actionNetwork = audit.snapshot().network.slice(networkOffset);

        actionPenaltyMap.set(targetAction.id, chosen.clicks + 1);
        exercisedActionIds.add(targetAction.id);
        exercisedActionEvidence.push({
          id: targetAction.id,
          widgetType: targetAction.widgetType,
          from: before.url,
          to: after.url,
          network: actionNetwork,
        });
        const integrity = await assertDOMIntegrity(page, `After Action: ${targetAction.text}`);
        console.log(`  -> DOM Integrity Verified (Visible elements: ${integrity.visibleCount}, Title: "${integrity.title}")`);

        if (step % 5 === 0 || step === maxSteps) {
          const screenshotName = `step${String(step).padStart(2, '0')}_${targetAction.widgetType}_${getFormattedTimestamp()}.png`;
          await page.screenshot({ path: path.join(roundDir, screenshotName) });
          console.log(`  [Checkpoint Screenshot] ${screenshotName}`);
        }
      } catch (actionErr: unknown) {
        failedActionIds.add(targetAction.id);
        console.error(`  -> Failed action remains uncovered: ${targetAction.id}`);
        console.error(`  -> Action failed and was excluded from coverage:`, actionErr instanceof Error ? actionErr.message : String(actionErr));
      }
    }

    const discoveredActions = discoveredActionIds.size;
    const exercisedActions = exercisedActionIds.size;
    const failedActions = failedActionIds.size;
    const coverage = discoveredActions === 0 ? 0 : exercisedActions / discoveredActions;
    const report = {
      browserSecurity: { webSecurityDisabled: browserArgs.includes('--disable-web-security'), mode: 'normal' },
      setupMutationEvidence,
      traversal: { maxSteps, stepsRun, terminationReason, discoveryScope: 'stable, visible DOM states reached through authenticated setup and clicked controls' },
      states: { discovered: totalStatesDiscovered, visited: totalStateVisits, terminal: terminalStates },
      actions: {
        discovered: discoveredActions,
        exercised: exercisedActions,
        failed: failedActions,
        failedIds: [...failedActionIds],
        unverified: unverifiedActionIds.size,
        unverifiedIds: [...unverifiedActionIds],
        exercisedEvidence: exercisedActionEvidence,
      },
      coverage: {
        exercised: exercisedActions,
        denominator: discoveredActions,
        percentage: Number((coverage * 100).toFixed(2)),
        denominatorDefinition: 'unique interactive controls visible in stable DOM snapshots for states visited before the step budget',
        excludesUnrenderedStates: true,
      },
      runtimeErrors: audit.errors,
      auditMetrics: audit.getSummary(),
      audit: audit.snapshot(),
    };
    fs.writeFileSync(path.join(roundDir, 'report.json'), JSON.stringify(report, null, 2));

    console.log('\n================================================================');
    console.log(' SMART HEURISTIC TRAVERSAL SUMMARY (智能化 / 启发式遍历)');
    console.log('================================================================');
    console.log(` Total Distinct UI States Discovered: ${totalStatesDiscovered}`);
    console.log(` Actions: discovered=${discoveredActions}, exercised=${exercisedActions}, failed=${failedActions}, unverified=${unverifiedActionIds.size}, terminalStates=${terminalStates}`);
    console.log(` Reproducible Coverage: ${exercisedActions}/${discoveredActions} (${report.coverage.percentage}%)`);
    console.log(` Unverified state-changing/ambiguous controls: ${unverifiedActionIds.size}`);
    console.log(` Fatal browser audit events: ${report.runtimeErrors.length}; exact observed optional events: ${report.auditMetrics.ignoredEvents}`);
    console.log(` Browser security: ${report.browserSecurity.mode}; disable-web-security flag=${report.browserSecurity.webSecurityDisabled}`);
    if (report.runtimeErrors.length > 0) {
      console.log(' Unhandled Errors:');
      report.runtimeErrors.forEach((error, index) => console.log(`   ${index + 1}. ${error.message} (${error.url ?? 'no URL'})`));
    }
    console.log('================================================================');

    audit.assertClean('Smart heuristic crawler');
    if (failedActions > 0) throw new Error(`Smart traversal has ${failedActions} failed UI action(s) that remain uncovered.`);

    console.log(`✅ Smart traversal completed; fatal audit events=${audit.errors.length}, exact optional events=${audit.getSummary().ignoredEvents}.`);
  } catch (err: unknown) {
    console.error('Fatal Smart Traversal error:', err instanceof Error ? err.message : String(err));
    await audit.writeFailureArtifacts(roundDir, 'smart-traversal-failure');
    throw err;
  } finally {
    await browser.close();
  }
}

void withTestServer(server => runSmartHeuristicTraversal(server.baseUrl, 30), { env: { ECONOMY_RANDOM: 'false' } })
  .catch((error: unknown) => {
    console.error('Smart traversal runner failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
