import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import puppeteer, { Browser, Page, HTTPRequest, HTTPResponse } from 'puppeteer';
import { findBrowserExecutable } from '../e2e/find-browser.ts';

export interface StateFingerprint {
  id: string;
  screen_family: string;
  entity_type: string;
  entity_id: string;
  business_state: string;
  active_modal: string;
  active_tab: string;
  visible_actions: string[];
  queue_bucket: string;
  economy_bucket: string;
  alert_state: string;
  raw_summary: string;
}

export interface StateAction {
  id: string;
  name: string;
  selector: string;
  action_type: 'click' | 'fill' | 'select' | 'navigate';
  value?: string;
  enabled: boolean;
}

export interface TransitionEdge {
  from: string;
  action: string;
  to: string;
  status: 'PASS' | 'FAIL' | 'BLOCKED' | 'UNKNOWN';
  network_calls: Array<{
    method: string;
    url: string;
    status: number;
    response_sample?: unknown;
  }>;
  console_errors: string[];
  duration_ms: number;
  error?: string;
  invariant_violated?: string;
}

export interface Finding {
  finding_id: string;
  subsystem: string;
  starting_state: string;
  action: string;
  expected_transition: string;
  observed_transition: string;
  ui_evidence: string;
  network_evidence?: {
    method: string;
    url: string;
    status: number;
    response: unknown;
  };
  console_error?: string;
  invariant_violated?: string;
  refresh_persistence_checked: boolean;
  reproduction_count: number;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  novelty_score: number;
  suspected_scope: string;
}

export interface FrontierItem {
  state_id: string;
  action: StateAction;
  priority: number;
  attempts: number;
  blocked_reason?: string;
}

export class GameStateObserver {
  private repoRoot: string;
  private workflowDir: string;
  private serverPort: number;
  private serverProcess: ChildProcess | null = null;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private currentNetworkCalls: Array<{ method: string; url: string; status: number; response_sample?: unknown }> = [];
  private currentConsoleErrors: string[] = [];
  constructor(repoRoot?: string, serverPort = 3188) {
    this.repoRoot = repoRoot || path.resolve(process.cwd());
    this.workflowDir = path.join(this.repoRoot, '.omp', 'workflow');
    this.serverPort = serverPort;
    fs.mkdirSync(this.workflowDir, { recursive: true });
  }

  async startServer(): Promise<void> {
    console.log(`[Observer] Starting backend server on port ${this.serverPort}...`);
    const dataDir = path.join(this.repoRoot, 'data', `test-run-${this.serverPort}`);
    fs.mkdirSync(dataDir, { recursive: true });

    return new Promise((resolve, reject) => {
      const nodeExec = fs.existsSync('/opt/magnate/.node22/bin/node') ? '/opt/magnate/.node22/bin/node' : process.execPath;
      this.serverProcess = spawn(
        nodeExec,
        ['--experimental-strip-types', 'server/index.ts'],
        {
          cwd: this.repoRoot,
          env: {
            ...process.env,
            PORT: String(this.serverPort),
            HOST: '127.0.0.1',
            DATA_DIR: dataDir,
            SPEED_MULTIPLIER: '10.0',
          },
          stdio: 'pipe',
        }
      );

      let started = false;
      this.serverProcess.stdout?.on('data', (data) => {
        const text = data.toString();
        if (text.includes('is LIVE') || text.includes('Server is LIVE')) {
          if (!started) {
            started = true;
            console.log(`[Observer] Server is live on port ${this.serverPort}`);
            resolve();
          }
        }
      });

      this.serverProcess.stderr?.on('data', (data) => {
        const text = data.toString();
        if (text.includes('ExperimentalWarning')) return;
        console.error(`[Server Stderr] ${text.trim()}`);
      });

      setTimeout(() => {
        if (!started) {
          started = true;
          console.log(`[Observer] Server startup timeout reached, proceeding to health check...`);
          resolve();
        }
      }, 4000);
    });
  }

  async launchBrowser(): Promise<Page> {
    const executablePath = findBrowserExecutable();
    console.log(`[Observer] Launching browser: ${executablePath}`);
    this.browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,900',
      ],
    });

    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1280, height: 900 });

    this.page.on('request', (req: HTTPRequest) => {
      // track requests
    });

    this.page.on('response', async (res: HTTPResponse) => {
      const url = res.url();
      if (url.includes('/api/')) {
        let sample: unknown = null;
        try {
          const contentType = res.headers()['content-type'] || '';
          if (contentType.includes('application/json')) {
            sample = await res.json();
          } else {
            const text = await res.text();
            sample = text.slice(0, 200);
          }
        } catch {
          // ignore stream read errors
        }
        this.currentNetworkCalls.push({
          method: res.request().method(),
          url: new URL(url).pathname,
          status: res.status(),
          response_sample: sample,
        });
      }
    });

    this.page.on('console', (msg) => {
      if (msg.type() === 'error') {
        this.currentConsoleErrors.push(msg.text());
      }
    });

    this.page.on('pageerror', (err) => {
      this.currentConsoleErrors.push(`[PageError] ${err.message}`);
    });

    return this.page;
  }

  resetTurnBuffers(): void {
    this.currentNetworkCalls = [];
    this.currentConsoleErrors = [];
  }

  async extractFingerprint(page: Page): Promise<{ fingerprint: StateFingerprint; actions: StateAction[] }> {
    const rawData = await page.evaluate(() => {
      const pathname = window.location.pathname;
      const bodyText = document.body.innerText || '';

      // Screen family detection
      let screenFamily = 'overview_landscape';
      if (pathname.includes('/b/')) screenFamily = 'building_detail';
      else if (pathname.includes('/warehouse/')) screenFamily = 'warehouse';
      else if (pathname.includes('/market/')) screenFamily = 'market';
      else if (pathname.includes('/encyclopedia/')) screenFamily = 'encyclopedia';
      else if (pathname.includes('/bonds/')) screenFamily = 'bonds';
      else if (pathname.includes('/executives/')) screenFamily = 'executives';
      else if (pathname.includes('/research/')) screenFamily = 'research';
      else if (pathname.includes('/headquarters/')) screenFamily = 'headquarters';
      else if (pathname.includes('/newspaper/')) screenFamily = 'newspaper';
      else if (pathname.includes('/messages/')) screenFamily = 'messages';
      else if (pathname.includes('/auth/') || pathname.includes('/login') || pathname.includes('/signin')) screenFamily = 'auth';

      // Modal detection
      const modalEl = document.querySelector('.modal, .modal-dialog, [role="dialog"], .popup');
      const activeModal = modalEl ? (modalEl.querySelector('.modal-title, h3, h4')?.textContent?.trim() || 'active_modal') : 'none';

      // Active Tab
      const activeTabEl = document.querySelector('.nav-tabs .active, .tab-active, [aria-selected="true"]');
      const activeTab = activeTabEl ? (activeTabEl.textContent?.trim() || 'default') : 'none';

      // Building / Entity info
      const buildingMatch = pathname.match(/\/b\/(\d+)\/?/);
      const entityId = buildingMatch ? buildingMatch[1] : 'root';
      
      const buildingHeader = document.querySelector('h1, h2, .building-title')?.textContent?.trim() || '';
      let entityType = 'general';
      if (buildingHeader.includes('种植园') || buildingHeader.includes('Plantation')) entityType = 'plantation';
      else if (buildingHeader.includes('农场') || buildingHeader.includes('Farm')) entityType = 'farm';
      else if (buildingHeader.includes('电厂') || buildingHeader.includes('Power')) entityType = 'power_plant';
      else if (buildingHeader.includes('水井') || buildingHeader.includes('Water')) entityType = 'water_well';
      else if (buildingHeader.includes('零售') || buildingHeader.includes('Store')) entityType = 'retail_store';

      // Business state
      let businessState = 'idle';
      if (bodyText.includes('正在生产') || bodyText.includes('In production') || bodyText.includes('生产中')) {
        businessState = 'producing';
      } else if (bodyText.includes('完成') || bodyText.includes('Finished') || bodyText.includes('领取') || bodyText.includes('Collect')) {
        businessState = 'finished';
      } else if (bodyText.includes('升级中') || bodyText.includes('Upgrading')) {
        businessState = 'upgrading';
      } else if (bodyText.includes('空置') || bodyText.includes('Empty slot') || bodyText.includes('建造')) {
        businessState = 'empty_slot';
      }

      // Queue bucket
      const queueItems = document.querySelectorAll('.queue-item, .production-queue-row, tr.queue-row');
      let queueBucket = 'empty';
      if (queueItems.length >= 3) queueBucket = 'full';
      else if (queueItems.length > 0) queueBucket = 'partial';

      // Economy bucket
      const moneyMatch = bodyText.match(/\$([0-9,]+(?:\.[0-9]+)?)/);
      let economyBucket = 'sufficient';
      if (bodyText.includes('$0') || bodyText.includes('$ 0')) economyBucket = 'zero';
      else if (bodyText.includes('资金不足') || bodyText.includes('Insufficient funds') || bodyText.includes('余额不足')) economyBucket = 'insufficient';

      // Alert state
      const alertEl = document.querySelector('.alert-danger, .alert-warning, .error-message');
      const alertState = alertEl ? (alertEl.textContent?.trim().slice(0, 50) || 'alert_present') : 'none';

      // Action Extraction
      const extractedActions: Array<{
        name: string;
        selector: string;
        action_type: 'click';
        enabled: boolean;
      }> = [];

      const clickableElements = document.querySelectorAll('button, a[href], [role="button"], input[type="submit"]');
      clickableElements.forEach((el, idx) => {
        const text = el.textContent?.trim().replace(/\s+/g, ' ') || '';
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return; // not visible
        
        // Strip timer noise from button text (e.g. "加速 (00:04:12)")
        const cleanText = text.replace(/\d{2}:\d{2}:\d{2}/g, 'TIMER').trim();
        if (!cleanText || cleanText.length > 40) return;

        const isBtnDisabled = el.hasAttribute('disabled') || el.classList.contains('disabled');
        
        // Build stable CSS selector
        let sel = '';
        if (el.id) sel = `#${el.id}`;
        else if (el.getAttribute('data-testid')) sel = `[data-testid="${el.getAttribute('data-testid')}"]`;
        else if (el.tagName === 'A' && el.getAttribute('href')?.startsWith('/')) sel = `a[href="${el.getAttribute('href')}"]`;
        else {
          sel = `${el.tagName.toLowerCase()}:contains("${cleanText.slice(0, 20)}")`;
        }

        extractedActions.push({
          name: cleanText,
          selector: sel,
          action_type: 'click',
          enabled: !isBtnDisabled,
        });
      });

      return {
        screenFamily,
        entityType,
        entityId,
        businessState,
        activeModal,
        activeTab,
        queueBucket,
        economyBucket,
        alertState,
        actions: extractedActions,
        title: document.title,
      };
    });

    const visibleActionsList = rawData.actions.map(a => `${a.name}:${a.enabled ? '1' : '0'}`).sort();
    
    // Normalized fingerprint hash
    const rawFingerprint = [
      rawData.screenFamily,
      `${rawData.entityType}:${rawData.entityId}`,
      rawData.businessState,
      `modal:${rawData.activeModal}`,
      `tab:${rawData.activeTab}`,
      `queue:${rawData.queueBucket}`,
      `eco:${rawData.economyBucket}`,
      `alert:${rawData.alertState}`,
      `actions:[${visibleActionsList.join(';')}]`,
    ].join('|');

    const hash = crypto.createHash('sha256').update(rawFingerprint).digest('hex').slice(0, 12);
    const fingerprintId = `STATE-${rawData.screenFamily}-${hash}`;

    const fingerprint: StateFingerprint = {
      id: fingerprintId,
      screen_family: rawData.screenFamily,
      entity_type: rawData.entityType,
      entity_id: rawData.entityId,
      business_state: rawData.businessState,
      active_modal: rawData.activeModal,
      active_tab: rawData.activeTab,
      visible_actions: visibleActionsList,
      queue_bucket: rawData.queueBucket,
      economy_bucket: rawData.economyBucket,
      alert_state: rawData.alertState,
      raw_summary: rawFingerprint,
    };

    const actions: StateAction[] = rawData.actions.map((a, idx) => ({
      id: `ACT-${fingerprintId}-${idx}`,
      name: a.name,
      selector: a.selector,
      action_type: 'click',
      enabled: a.enabled,
    }));

    return { fingerprint, actions };
  }

  async auditInvariants(page: Page): Promise<{ passed: boolean; violation?: string; detail?: string }> {
    const domCheck = await page.evaluate(() => {
      const text = document.body.innerText || '';
      const nanMatch = text.match(/\$(?:NaN|undefined)|(?:NaN|undefined)\$|BoostsNaN/);
      if (nanMatch) return { violation: 'INV-MONEY-NOT-NAN', detail: `Found text: ${nanMatch[0]}` };

      const crashKeywords = ['An unexpected error occurred', 'Failed to load app', 'Cannot read properties of undefined'];
      for (const k of crashKeywords) {
        if (text.includes(k)) return { violation: 'INV-NO-CRASH', detail: `Crash message found: ${k}` };
      }

      const root = document.getElementById('root');
      if (root && root.children.length === 0 && text.trim().length === 0) {
        return { violation: 'INV-NO-WHITE-SCREEN', detail: 'Root is empty and body has no text' };
      }

      return null;
    });

    if (domCheck) {
      return { passed: false, violation: domCheck.violation, detail: domCheck.detail };
    }

    // Check network errors
    for (const call of this.currentNetworkCalls) {
      if (call.status === 500) {
        return {
          passed: false,
          violation: 'INV-NETWORK-CORRECTNESS',
          detail: `HTTP 500 on ${call.method} ${call.url}`,
        };
      }
      if (call.status === 404 && call.url.startsWith('/api/')) {
        return {
          passed: false,
          violation: 'INV-NETWORK-CORRECTNESS',
          detail: `API Not Found 404 on ${call.method} ${call.url}`,
        };
      }
    }

    return { passed: true };
  }

  async updateWorkflowState(
    nodes: Record<string, StateFingerprint>,
    transitions: TransitionEdge[],
    frontier: FrontierItem[],
    findings: Finding[]
  ): Promise<void> {
    // 1. Update state-graph.json
    const graphData = {
      version: 1,
      nodes,
      transitions,
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(this.workflowDir, 'state-graph.json'), JSON.stringify(graphData, null, 2), 'utf-8');

    // 2. Generate state-graph.mmd
    let mmd = 'graph TD\n';
    const nodeNames = Object.keys(nodes);
    for (const nid of nodeNames) {
      const node = nodes[nid];
      mmd += `  ${nid.replace(/[^a-zA-Z0-9_]/g, '_')}["${node.screen_family}\\n(${node.business_state})"]\n`;
    }
    for (const t of transitions) {
      const fromSafe = t.from.replace(/[^a-zA-Z0-9_]/g, '_');
      const toSafe = t.to.replace(/[^a-zA-Z0-9_]/g, '_');
      const label = t.action.slice(0, 15).replace(/"/g, "'");
      const statusIcon = t.status === 'PASS' ? '✔' : t.status === 'FAIL' ? '❌' : '?';
      mmd += `  ${fromSafe} -->|"${statusIcon} ${label}"| ${toSafe}\n`;
    }
    fs.writeFileSync(path.join(this.workflowDir, 'state-graph.mmd'), mmd, 'utf-8');

    // 3. Update frontier.json
    fs.writeFileSync(path.join(this.workflowDir, 'frontier.json'), JSON.stringify({ queue: frontier }, null, 2), 'utf-8');

    // 4. Update findings.jsonl
    const findingsContent = findings.map(f => JSON.stringify(f)).join('\n');
    fs.writeFileSync(path.join(this.workflowDir, 'findings.jsonl'), findingsContent ? findingsContent + '\n' : '', 'utf-8');

    // 5. Compute and update coverage.json
    const uniquePages = new Set(Object.values(nodes).map(n => n.screen_family)).size;
    const executedActionsCount = transitions.length;
    const verifiedPassCount = transitions.filter(t => t.status === 'PASS').length;
    const failedTransitionsCount = transitions.filter(t => t.status === 'FAIL').length;
    const totalTransitions = transitions.length;

    const pageCoveragePct = Math.min(100, Math.round((uniquePages / 12) * 100));
    const actionCoveragePct = totalTransitions > 0 ? Math.min(100, Math.round((executedActionsCount / (executedActionsCount + frontier.length)) * 100)) : 0;
    const transitionCoveragePct = totalTransitions > 0 ? Math.min(100, Math.round((verifiedPassCount / totalTransitions) * 100)) : 0;
    
    // Multi-dimensional metrics
    const boundaryTested = transitions.filter(t => t.action.includes('0') || t.action.includes('最大') || t.action.includes('Max')).length;
    const interactionTested = transitions.filter(t => t.action.includes('购买') || t.action.includes('出售') || t.action.includes('研究')).length;
    const invariantTested = Math.min(12, verifiedPassCount > 0 ? 5 : 0);

    const coverageData = {
      page_coverage: { discovered: uniquePages, visited: uniquePages, percentage: pageCoveragePct },
      action_coverage: { discovered: executedActionsCount + frontier.length, executed: executedActionsCount, percentage: actionCoveragePct },
      transition_coverage: { discovered: totalTransitions, verified_pass: verifiedPassCount, failed: failedTransitionsCount, percentage: transitionCoveragePct },
      boundary_coverage: { tested: boundaryTested, total_target: 20, percentage: Math.min(100, Math.round((boundaryTested / 20) * 100)) },
      interaction_coverage: { tested: interactionTested, total_target: 15, percentage: Math.min(100, Math.round((interactionTested / 15) * 100)) },
      invariant_coverage: { verified: invariantTested, total_invariants: 12, percentage: Math.min(100, Math.round((invariantTested / 12) * 100)) },
      last_updated: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(this.workflowDir, 'coverage.json'), JSON.stringify(coverageData, null, 2), 'utf-8');

    // 6. Update coverage-summary.txt
    const p0Count = findings.filter(f => f.severity === 'P0').length;
    const p1Count = findings.filter(f => f.severity === 'P1').length;
    const summaryText = `============================================================
           SimCompanies AI Debug Workflow Dashboard
============================================================
Current Frontier: Breadth Exploration Wave 1
Explorer Status: active
Open P0 Findings: ${p0Count}
Open P1 Findings: ${p1Count}
Current Fix: ${p0Count + p1Count > 0 ? findings[0].finding_id : 'None'}
Verify Status: ${p0Count + p1Count > 0 ? 'Pending Fix' : 'Verified Pass'}
Total Discovered States: ${nodeNames.length}
Transitions: ${verifiedPassCount} passed / ${failedTransitionsCount} failed / ${totalTransitions - verifiedPassCount - failedTransitionsCount} unknown
------------------------------------------------------------
Coverage Metrics:
- Page Coverage:         ${pageCoveragePct}%
- Action Coverage:       ${actionCoveragePct}%
- Transition Coverage:   ${transitionCoveragePct}%
- Boundary Coverage:     ${Math.min(100, Math.round((boundaryTested / 20) * 100))}%
- Interaction Coverage:  ${Math.min(100, Math.round((interactionTested / 15) * 100))}%
- Invariant Coverage:    ${Math.min(100, Math.round((invariantTested / 12) * 100))}%
------------------------------------------------------------
Next Automatic Action: ${p0Count + p1Count > 0 ? `Deep Debugger FIX on ${findings[0].finding_id}` : 'Continue Frontier Expansion'}
============================================================\n`;
    fs.writeFileSync(path.join(this.workflowDir, 'coverage-summary.txt'), summaryText, 'utf-8');

    // 7. Update run-state.json
    const runState = {
      run_id: 'RUN-20260831-01',
      started_at: '2026-08-31T06:40:00Z',
      current_phase: p0Count + p1Count > 0 ? 'deep_debugging' : 'breadth_exploration',
      active_frontier: frontier.length > 0 ? frontier[0].state_id : 'completed',
      active_finding: p0Count + p1Count > 0 ? findings[0].finding_id : null,
      active_fix: p0Count + p1Count > 0 ? findings[0].finding_id : null,
      last_verified_transition: verifiedPassCount > 0 ? transitions[transitions.length - 1].action : null,
      graph_revision: transitions.length + 1,
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(this.workflowDir, 'run-state.json'), JSON.stringify(runState, null, 2), 'utf-8');
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    if (this.serverProcess) {
      this.serverProcess.kill('SIGKILL');
      this.serverProcess = null;
    }
  }
}
