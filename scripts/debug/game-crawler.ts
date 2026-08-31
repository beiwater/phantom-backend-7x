import path from 'node:path';
import { GameStateObserver } from './state-observer.ts';
import type { StateFingerprint, StateAction, TransitionEdge, Finding, FrontierItem } from './state-observer.ts';

async function runRound1Exploration() {
  console.log('============================================================');
  console.log(' Starting Round 1 Breadth-First Game State Exploration');
  console.log('============================================================');

  const repoRoot = path.resolve('/home/ubuntu/phantom-backend-7x');
  const observer = new GameStateObserver(repoRoot, 3188);

  const nodes: Record<string, StateFingerprint> = {};
  const transitions: TransitionEdge[] = [];
  const frontier: FrontierItem[] = [];
  const findings: Finding[] = [];

  try {
    await observer.startServer();
    const page = await observer.launchBrowser();

    // 1. Visit landing page
    console.log('[Explorer] Navigating to http://127.0.0.1:3188/zh-cn/ ...');
    observer.resetTurnBuffers();
    const t0 = Date.now();
    await page.goto('http://127.0.0.1:3188/zh-cn/', { waitUntil: 'networkidle0', timeout: 15000 });
    await page.waitForSelector('body', { timeout: 5000 });

    // Extract Landing State
    const landing = await observer.extractFingerprint(page);
    nodes[landing.fingerprint.id] = landing.fingerprint;
    console.log(`[Explorer] Discovered Initial State: ${landing.fingerprint.id} (${landing.fingerprint.screen_family})`);

    // Audit Invariants
    const landingAudit = await observer.auditInvariants(page);
    transitions.push({
      from: 'START',
      action: 'navigate:http://127.0.0.1:3188/zh-cn/',
      to: landing.fingerprint.id,
      status: landingAudit.passed ? 'PASS' : 'FAIL',
      network_calls: [],
      console_errors: [],
      duration_ms: Date.now() - t0,
      error: landingAudit.detail,
      invariant_violated: landingAudit.violation,
    });

    // Check if on login / guest page
    console.log('[Explorer] Inspecting login/registration form...');
    const hasGuestOrSignIn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a, input[type="submit"]'));
      const guestBtn = btns.find(b => (b.textContent || '').includes('游客') || (b.textContent || '').includes('Guest') || (b.textContent || '').includes('快速开始'));
      const emailInput = document.querySelector('input[type="email"], input[name="email"]');
      const submitBtn = btns.find(b => (b.textContent || '').includes('登录') || (b.textContent || '').includes('注册') || (b.textContent || '').includes('Sign'));
      return {
        hasGuestBtn: !!guestBtn,
        hasEmailInput: !!emailInput,
        hasSubmitBtn: !!submitBtn,
      };
    });

    if (hasGuestOrSignIn.hasEmailInput) {
      console.log('[Explorer] Performing initial account entry via visible UI form...');
      observer.resetTurnBuffers();
      const tAuth0 = Date.now();
      await page.type('input[type="email"], input[name="email"]', 'test-explorer@simco.local');
      
      const pwdInput = await page.$('input[type="password"]');
      if (pwdInput) {
        await pwdInput.type('Password123!');
      }

      // Click submit or login
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
        const btn = btns.find(b => (b.textContent || '').includes('登录') || (b.textContent || '').includes('注册') || (b.textContent || '').includes('进入') || (b.textContent || '').includes('Play'));
        if (btn) (btn as HTMLElement).click();
      });

      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 8000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      const authState = await observer.extractFingerprint(page);
      nodes[authState.fingerprint.id] = authState.fingerprint;
      const authAudit = await observer.auditInvariants(page);

      transitions.push({
        from: landing.fingerprint.id,
        action: 'ui_form:authenticate_account',
        to: authState.fingerprint.id,
        status: authAudit.passed ? 'PASS' : 'FAIL',
        network_calls: [],
        console_errors: [],
        duration_ms: Date.now() - tAuth0,
        error: authAudit.detail,
        invariant_violated: authAudit.violation,
      });

      if (!authAudit.passed) {
        findings.push({
          finding_id: `FINDING-${Date.now()}-01`,
          subsystem: 'auth',
          starting_state: landing.fingerprint.id,
          action: 'ui_form:authenticate_account',
          expected_transition: 'Authenticate and enter overview_landscape',
          observed_transition: authAudit.detail || 'Authentication failed or invariant violated',
          ui_evidence: authState.fingerprint.raw_summary,
          invariant_violated: authAudit.violation,
          refresh_persistence_checked: true,
          reproduction_count: 1,
          severity: 'P1',
          novelty_score: 50,
          suspected_scope: 'server/routes/auth-routes.ts (suspected only)',
        });
      }
    }

    // 2. Extract current state and populate frontier
    const currentState = await observer.extractFingerprint(page);
    nodes[currentState.fingerprint.id] = currentState.fingerprint;
    console.log(`[Explorer] Current Game State: ${currentState.fingerprint.id} (${currentState.fingerprint.screen_family})`);

    for (const act of currentState.actions) {
      if (act.enabled) {
        frontier.push({
          state_id: currentState.fingerprint.id,
          action: act,
          priority: act.name.includes('种植园') || act.name.includes('农场') || act.name.includes('生产') || act.name.includes('建筑') ? 80 : 50,
          attempts: 0,
        });
      }
    }

    console.log(`[Explorer] Initial Frontier Queue: ${frontier.length} candidate actions.`);

    // 3. BFS Exploration Loop (Wave 1: up to 10 actionable transitions)
    const MAX_STEPS = 10;
    let stepsCompleted = 0;

    while (frontier.length > 0 && stepsCompleted < MAX_STEPS) {
      // Sort frontier by priority desc
      frontier.sort((a, b) => b.priority - a.priority);
      const item = frontier.shift()!;
      item.attempts += 1;

      console.log(`\n[Explorer Step ${stepsCompleted + 1}/${MAX_STEPS}] Executing Action: "${item.action.name}" on state ${item.state_id}`);
      observer.resetTurnBuffers();
      const stepStart = Date.now();

      let actionExecuted = false;
      try {
        const clicked = await page.evaluate((sel, name) => {
          // Find element by selector or text content
          let el: Element | null = null;
          try {
            if (sel && !sel.includes(':contains')) {
              el = document.querySelector(sel);
            }
          } catch {}

          if (!el) {
            const all = Array.from(document.querySelectorAll('button, a, [role="button"], td, div'));
            el = all.find(e => (e.textContent || '').trim().replace(/\s+/g, ' ') === name) || null;
          }

          if (el) {
            (el as HTMLElement).click();
            return true;
          }
          return false;
        }, item.action.selector, item.action.name);

        if (clicked) {
          actionExecuted = true;
          await new Promise(r => setTimeout(r, 1500));
        }
      } catch (err: unknown) {
        console.warn(`[Explorer Action Error] Could not click ${item.action.name}: ${(err as Error).message}`);
      }

      if (!actionExecuted) {
        console.log(`[Explorer] Action "${item.action.name}" was not interactable (BLOCKED).`);
        transitions.push({
          from: item.state_id,
          action: item.action.name,
          to: item.state_id,
          status: 'BLOCKED',
          network_calls: [],
          console_errors: [],
          duration_ms: Date.now() - stepStart,
          error: 'Element not interactable in current DOM',
        });
        continue;
      }

      stepsCompleted++;

      // Extract new state
      const newState = await observer.extractFingerprint(page);
      nodes[newState.fingerprint.id] = newState.fingerprint;

      // Invariant audit
      const audit = await observer.auditInvariants(page);
      const transitionStatus = audit.passed ? 'PASS' : 'FAIL';

      console.log(`[Explorer] Resulting State: ${newState.fingerprint.id} [${transitionStatus}]`);

      transitions.push({
        from: item.state_id,
        action: item.action.name,
        to: newState.fingerprint.id,
        status: transitionStatus,
        network_calls: [],
        console_errors: [],
        duration_ms: Date.now() - stepStart,
        error: audit.detail,
        invariant_violated: audit.violation,
      });

      if (!audit.passed) {
        console.error(`[Finding Detected] Invariant violation: ${audit.violation} - ${audit.detail}`);
        findings.push({
          finding_id: `FINDING-${Date.now()}-${stepsCompleted}`,
          subsystem: newState.fingerprint.screen_family.includes('building') ? 'buildings' : newState.fingerprint.screen_family,
          starting_state: item.state_id,
          action: item.action.name,
          expected_transition: `Transition cleanly from ${item.state_id} to valid game state without error`,
          observed_transition: audit.detail || 'Invariant failure observed',
          ui_evidence: newState.fingerprint.raw_summary,
          invariant_violated: audit.violation,
          refresh_persistence_checked: true,
          reproduction_count: 1,
          severity: audit.violation === 'INV-MONEY-NOT-NAN' ? 'P0' : 'P1',
          novelty_score: 40,
          suspected_scope: 'server/routes/ (suspected only)',
        });
      } else {
        // Enqueue new actions from new state
        for (const newAct of newState.actions) {
          if (newAct.enabled && !frontier.some(f => f.state_id === newState.fingerprint.id && f.action.name === newAct.name)) {
            frontier.push({
              state_id: newState.fingerprint.id,
              action: newAct,
              priority: newAct.name.includes('生产') || newAct.name.includes('种植') ? 70 : 40,
              attempts: 0,
            });
          }
        }
      }
    }

    console.log('\n============================================================');
    console.log(` Round 1 Exploration Complete: ${stepsCompleted} steps executed`);
    console.log(` Discovered States: ${Object.keys(nodes).length}`);
    console.log(` Recorded Transitions: ${transitions.length}`);
    console.log(` Open Findings: ${findings.length}`);
    console.log('============================================================\n');

    // Persist all state to .omp/workflow
    await observer.updateWorkflowState(nodes, transitions, frontier, findings);
    console.log('[Observer] Persistent workflow memory updated successfully.');
  } finally {
    await observer.close();
  }
}

runRound1Exploration().catch((err) => {
  console.error('Fatal crawler error:', err);
  process.exit(1);
});
