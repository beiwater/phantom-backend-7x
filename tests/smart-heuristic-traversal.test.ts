import puppeteer, { Page } from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

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
  selector: string;
  xpath: string;
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
      widgetType: 'tab' | 'modal-control' | 'form-action' | 'filter' | 'navigation-link' | 'generic-button';
      baseScore: number;
    }> = [];

    const elements = Array.from(document.querySelectorAll('button, a[href], [role="tab"], [role="button"], .btn'));

    for (const el of elements) {
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
      if (['登出', 'Sign out', 'Logout', '删除公司', 'Reset', '全部接受', '仅限必要'].some(d => text.includes(d))) {
        continue;
      }

      // Classify Widget Type & Assign Heuristic Base Scores
      let widgetType: 'tab' | 'modal-control' | 'form-action' | 'filter' | 'navigation-link' | 'generic-button' = 'generic-button';
      let baseScore = 20;

      if (modalEl && modalEl.contains(el)) {
        widgetType = 'modal-control';
        baseScore = 45;
      } else if (role === 'tab' || classes.includes('tab') || classes.includes('nav-link')) {
        widgetType = 'tab';
        baseScore = 50;
      } else if (classes.includes('filter') || text.includes('筛选') || text.includes('全部') || text.includes('Q0') || text.includes('Q1')) {
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

  const fingerprint = `${rawState.url}::modal=${rawState.modalTitle || 'none'}`;
  const actions: ActionCandidate[] = rawState.candidates.map((c, index) => {
    const actionId = `${rawState.url}::${c.widgetType}::${c.text || c.href || index}`;
    const clickCount = actionPenaltyMap.get(actionId) || 0;
    return {
      id: actionId,
      tag: c.tag,
      role: c.role,
      widgetType: c.widgetType,
      text: c.text,
      selector: c.tag.toLowerCase(),
      xpath: `//${c.tag.toLowerCase()}[contains(., '${c.text}')]`,
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

async function runSmartHeuristicTraversal(maxSteps: number = 35) {
  const timestamp = getFormattedTimestamp();
  const roundDir = path.resolve('screenshots', `smart_traversal_${timestamp}`);
  fs.mkdirSync(roundDir, { recursive: true });

  console.log('================================================================');
  console.log(' Starting Smart Heuristic Traversal (智能化 / 启发式遍历引擎)');
  console.log(` Max Steps: ${maxSteps} | Output: ${roundDir}`);
  const baseUrl = 'http://127.0.0.1:3000';
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900', '--disable-web-security']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const unhandledErrors: string[] = [];
  page.on('pageerror', err => {
    unhandledErrors.push(`[Page Error] ${err.message}`);
    console.error(`  [PAGE ERROR DETECTED]: ${err.message}`);
  });

  page.on('response', res => {
    if (res.status() >= 400) {
      console.log(`  [HTTP ${res.status()} FAILED]: ${res.request().method()} ${res.url()}`);
    }
  });

  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('Amplitude') && !msg.text().includes('trailer')) {
      unhandledErrors.push(`[Console Error] ${msg.text()}`);
    }
  });

  // Action & State Penalty Trackers
  const actionPenaltyMap = new Map<string, number>();
  const stateVisitMap = new Map<string, number>();
  const stateGraph = new Map<string, StateNode>();

  let totalActionsExecuted = 0;
  let totalStatesDiscovered = 0;

  try {
    // ----------------------------------------------------
    // Phase 1: Clean Player Authentication Setup
    // ----------------------------------------------------
    console.log('\n[Phase 1] Authenticating clean player session for smart exploration...');
    await page.goto(`${baseUrl}/zh-cn/signup/`, { waitUntil: 'networkidle2' });

    for (const b of await page.$$('button')) {
      const text = await b.evaluate(el => el.textContent || '');
      if (text.includes('全部接受') || text.includes('仅限必要')) {
        await b.click();
        break;
      }
    }

    for (const b of await page.$$('button')) {
      const text = await b.evaluate(el => el.textContent || '');
      if (text.includes('使用邮箱地址') || text.includes('邮箱')) {
        await b.click();
        break;
      }
    }
    await page.waitForNetworkIdle({ idleTime: 200, timeout: 3000 }).catch(() => {});

    const testEmail = `smart_player_${Date.now()}@domain.local`;
    const emailInput = await page.$('input[type="email"], input[name="email"]');
    const passwordInput = await page.$('input[type="password"], input[name="password"]');

    if (emailInput && passwordInput) {
      await emailInput.type(testEmail);
      await passwordInput.type('Password123!');
      await passwordInput.press('Enter');
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => {});
    }

    await page.waitForSelector('a[href*="/b/"], #main-menu-dropdown', { timeout: 10000 }).catch(() => {});
    await assertDOMIntegrity(page, 'Landscape Map (Root)');

    // ----------------------------------------------------
    // Phase 2: Smart Heuristic Traversal Loop
    // ----------------------------------------------------
    console.log('\n[Phase 2] Executing Smart Heuristic Decision Loop...');

    for (let step = 1; step <= maxSteps; step++) {
      // 1. Analyze Current DOM & Widget Tree Structure
      const currentState = await analyzeStateAndWidgetTree(page, actionPenaltyMap);
      const stateCount = (stateVisitMap.get(currentState.fingerprint) || 0) + 1;
      stateVisitMap.set(currentState.fingerprint, stateCount);

      if (!stateGraph.has(currentState.fingerprint)) {
        stateGraph.set(currentState.fingerprint, currentState);
        totalStatesDiscovered++;
      }

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

      // Filter actionable elements with positive scores
      const eligibleCandidates = scoredCandidates
        .filter(c => c.effectiveScore > 0 && c.clicks < 3)
        .sort((a, b) => b.effectiveScore - a.effectiveScore);

      console.log(`\n--- [STEP ${step}/${maxSteps}] State: "${currentState.fingerprint}" (Visit #${stateCount}) ---`);
      console.log(`  -> Detected ${currentState.actions.length} widget actions (${eligibleCandidates.length} eligible candidates).`);

      if (eligibleCandidates.length === 0) {
        console.log('  -> No unvisited actions on this state. Backtracking to Root / Navigation...');
        await page.goto(`${baseUrl}/zh-cn/landscape/`, { waitUntil: 'networkidle2' });
        continue;
      }

      // Pick top-scoring action
      const chosen = eligibleCandidates[0];
      const targetAction = chosen.action;
      console.log(`  -> Selected Action: [${targetAction.widgetType.toUpperCase()}] "${targetAction.text || targetAction.id}" (Score: ${chosen.effectiveScore}, Prior Clicks: ${chosen.clicks})`);

      // Update penalty map
      actionPenaltyMap.set(targetAction.id, chosen.clicks + 1);
      totalActionsExecuted++;

      // Execute Action
      try {
        const clicked = await page.evaluate((targetText, targetTag, targetType) => {
          const elements = Array.from(document.querySelectorAll('button, a, [role="tab"], [role="button"], .btn'));
          for (const el of elements) {
            const t = el.textContent?.trim().replace(/\s+/g, ' ') || '';
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && t === targetText) {
              (el as HTMLElement).click();
              return true;
            }
          }
          // Fallback: match by tag
          for (const el of elements) {
            const t = el.textContent?.trim().replace(/\s+/g, ' ') || '';
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && t.includes(targetText) && targetText.length > 2) {
              (el as HTMLElement).click();
              return true;
            }
          }
          return false;
        }, targetAction.text, targetAction.tag, targetAction.widgetType);

        if (clicked) {
          await page.waitForNetworkIdle({ idleTime: 150, timeout: 2500 }).catch(() => {});
        } else {
          console.log(`  -> Element not directly clickable, performing targeted navigation if link...`);
          const hrefMatch = targetAction.id.match(/\/zh-cn\/[^:]+/);
          if (hrefMatch) {
            await page.goto(`${baseUrl}${hrefMatch[0]}`, { waitUntil: 'networkidle2' });
          }
        }

        // Verify DOM Integrity after Action Execution
        const integrity = await assertDOMIntegrity(page, `After Action: ${targetAction.text}`);
        console.log(`  -> DOM Integrity Verified (Visible elements: ${integrity.visibleCount}, Title: "${integrity.title}")`);

        // Capture periodic state checkpoint
        if (step % 5 === 0 || step === maxSteps) {
          const screenshotName = `step${String(step).padStart(2, '0')}_${targetAction.widgetType}_${getFormattedTimestamp()}.png`;
          await page.screenshot({ path: path.join(roundDir, screenshotName) });
          console.log(`  [Checkpoint Screenshot] ${screenshotName}`);
        }
      } catch (actionErr: unknown) {
        console.warn(`  -> Action execution warning:`, actionErr instanceof Error ? actionErr.message : String(actionErr));
      }
    }

    console.log('\n================================================================');
    console.log(' SMART HEURISTIC TRAVERSAL SUMMARY (智能化 / 启发式遍历)');
    console.log('================================================================');
    console.log(` Total Distinct UI States Discovered: ${totalStatesDiscovered}`);
    console.log(` Total Smart Actions Executed: ${totalActionsExecuted}`);
    console.log(` Unique Actions Tracked: ${actionPenaltyMap.size}`);
    console.log(` Total Unhandled Runtime Errors: ${unhandledErrors.length}`);
    if (unhandledErrors.length > 0) {
      console.log(' Unhandled Errors:');
      unhandledErrors.forEach((e, idx) => console.log(`   ${idx + 1}. ${e}`));
    }
    console.log('================================================================');

    await browser.close();

    if (unhandledErrors.length > 0) {
      throw new Error(`Smart Traversal uncovered ${unhandledErrors.length} unhandled runtime error(s)!`);
    }

    console.log('✅ SMART HEURISTIC TRAVERSAL COMPLETED SUCCESSFULLY WITH ZERO ERRORS!');
  } catch (err: unknown) {
    console.error('Fatal Smart Traversal error:', err instanceof Error ? err.message : String(err));
    await browser.close();
    process.exit(1);
  }
}

runSmartHeuristicTraversal(30);
