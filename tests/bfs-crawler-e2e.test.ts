import puppeteer, { type Page } from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { attachBrowserAudit, waitForUiStable, waitForUiTransition } from './e2e/support/browser-audit.ts';

function getFormattedTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function takeTimestampedScreenshot(page: Page, roundDir: string, depth: number, stepNum: number, stepName: string) {
  const ts = getFormattedTimestamp();
  const safeName = stepName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  const filename = `level${depth}_step${String(stepNum).padStart(2, '0')}_${safeName}_${ts}.png`;
  const filePath = path.join(roundDir, filename);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`  [Screenshot] ${filename}`);
  return filePath;
}

// Scientific DOM Integrity & White Screen Check
async function assertDOMIntegrity(page: Page, pageName: string) {
  const check = await page.evaluate(() => {
    const root = document.getElementById('root');
    const bodyText = document.body.innerText ? document.body.innerText.trim() : '';
    const visibleCount = Array.from(document.querySelectorAll('div, a, button, h1, h2, h3, table, img')).filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).length;

    const crashKeywords = ['An unexpected error occurred', 'Failed to load app', 'Something went wrong', 'Cannot read properties'];
    const foundCrash = crashKeywords.find(k => bodyText.includes(k));

    const nanKeywords = ['$NaN', 'NaN$', 'BoostsNaN', 'BoostNaN', 'Sim BoostsNaN'];
    const foundNaN = nanKeywords.find(k => bodyText.includes(k));

    return {
      rootChildCount: root ? root.children.length : 0,
      textLength: bodyText.length,
      visibleCount,
      foundCrash,
      foundNaN,
      title: document.title,
      snippet: bodyText.slice(0, 100).replace(/\s+/g, ' ')
    };
  });

  if (check.rootChildCount === 0 || check.textLength < 5 || check.visibleCount === 0) {
    throw new Error(`[WHITE SCREEN DETECTED] Page '${pageName}' is blank! (Visible elements: ${check.visibleCount})`);
  }
  if (check.foundCrash) {
    throw new Error(`[CRASH STATE DETECTED] Page '${pageName}' contains crash keyword: '${check.foundCrash}'`);
  }
  if (check.foundNaN) {
    throw new Error(`[NAN CORRUPTION DETECTED] Page '${pageName}' contains NaN error: '${check.foundNaN}'`);
  }

  return check;
}

interface BFSNode {
  url: string;
  name: string;
  depth: number;
  path: string[];
}

function normalizePath(value: string): string {
  const pathValue = value.replace(/\/+$/, '');
  return pathValue || '/';
}

async function clickVisibleLink(page: Page, targetPath: string, audit: ReturnType<typeof attachBrowserAudit>): Promise<void> {
  const expectedPath = normalizePath(targetPath);
  const links = await page.$$('a[href]');
  for (const link of links) {
    const details = await link.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const anchor = element as HTMLAnchorElement;
      return {
        visible: rect.width > 0 && rect.height > 0,
        path: new URL(anchor.href, window.location.href).pathname
      };
    });
    if (details.visible && normalizePath(details.path) === expectedPath) {
      const before = await waitForUiStable(page, { action: `before visible link ${expectedPath}` });
      audit.recordAction(`click visible link ${expectedPath}`);
      await link.click();
      await waitForUiTransition(page, before, { action: `navigate to ${expectedPath}` });
      return;
    }
  }
  throw new Error(`Visible navigation link was not found: ${targetPath}`);
}

async function clickVisibleButtonContaining(
  page: Page,
  textFragments: string[],
  audit: ReturnType<typeof attachBrowserAudit>,
  action: string,
): Promise<boolean> {
  for (const button of await page.$$('button')) {
    const details = await button.evaluate(element => ({
      text: element.textContent?.trim() ?? '',
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

async function returnToRoot(page: Page, rootPath: string, audit: ReturnType<typeof attachBrowserAudit>): Promise<void> {
  const expectedRoot = normalizePath(rootPath);
  for (let attempt = 0; attempt < 20; attempt++) {
    if (normalizePath(new URL(page.url()).pathname) === expectedRoot) return;

    const rootLink = await page.$(`a[href="${rootPath}"]`);
    const rootLinkVisible = rootLink && await rootLink.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (rootLinkVisible) {
      await clickVisibleLink(page, rootPath, audit);
      continue;
    }
    const before = await waitForUiStable(page, { action: 'before browser history backtrack' });
    audit.recordAction('use browser history to backtrack toward crawler root');
    const response = await page.goBack({ waitUntil: 'domcontentloaded', timeout: 5000 });
    if (!response || page.url() === before.url) break;
    await waitForUiStable(page, { action: 'complete browser history backtrack' });
  }
  if (normalizePath(new URL(page.url()).pathname) !== expectedRoot) {
    throw new Error(`Could not return to crawler root: ${page.url()}`);
  }
}

async function navigateByVisibleClicks(page: Page, pathFromRoot: string[], rootPath: string, audit: ReturnType<typeof attachBrowserAudit>): Promise<void> {
  await returnToRoot(page, rootPath, audit);
  for (const targetPath of pathFromRoot) {
    await clickVisibleLink(page, targetPath, audit);
  }
}

async function runBFSCrawler(maxDepth: number = 3) {
  const timestamp = getFormattedTimestamp();
  const roundDir = path.resolve('screenshots', `bfs_${timestamp}`);
  fs.mkdirSync(roundDir, { recursive: true });

  console.log('================================================================');
  console.log(' Starting Breadth-First Search (BFS) Comprehensive UI Crawler');
  console.log(` Max Depth: ${maxDepth} | Artifact Directory: ${roundDir}`);
  console.log('================================================================');

  const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const audit = attachBrowserAudit(page);

  const stubEndpoints = new Set<string>();
  page.on('response', response => {
    const responseHeaders = response.headers();
    if (response.status() === 501 || responseHeaders['x-backend-stub'] === 'true') {
      const request = response.request();
      stubEndpoints.add(`${request.method()} ${new URL(response.url()).pathname}`);
    }
  });

  let totalVisitedPages = 0;
  let totalAttemptedPages = 0;
  let unreachableNodes = 0;
  const unreachablePaths = new Set<string>();
  const discoveredButtonIds = new Set<string>();
  const exercisedButtonIds = new Set<string>();
  const failedButtonIds = new Set<string>();
  const unverifiedButtonIds = new Set<string>();
  const actionPenaltyMap = new Map<string, number>();
  let runFailed = false;
  let step = 1;

  try {
    // ----------------------------------------------------
    // Level 0: Authentication & Initial Entry Setup
    // ----------------------------------------------------
    console.log('\n========================================================');
    console.log(' [BFS LEVEL 0] Initial Landing & Player Authentication');
    console.log('========================================================');

    await page.goto(`${baseUrl}/zh-cn/signup/`, { waitUntil: 'domcontentloaded' });
    await waitForUiStable(page, { action: 'load signup page' });
    await assertDOMIntegrity(page, 'Signup Page');
    await takeTimestampedScreenshot(page, roundDir, 0, step++, 'signup_page');

    // Dismiss Cookie banner
    await clickVisibleButtonContaining(page, ['全部接受', '仅限必要'], audit, 'dismiss cookie banner');

    // Click email registration button
    await clickVisibleButtonContaining(page, ['使用邮箱地址', '邮箱'], audit, 'choose email registration');

    const testEmail = `bfs_player_${Date.now()}@example.local`;
    const emailInput = await page.$('input[type="email"], input[name="email"]');
    const passwordInput = await page.$('input[type="password"], input[name="password"]');

    if (!emailInput || !passwordInput) throw new Error('[UI_ACTION_FAILED] Signup form did not expose email and password inputs');
    await emailInput.type(testEmail);
    await passwordInput.type('Password123!');
    const beforeRegistration = await waitForUiStable(page, { action: 'before signup submission' });
    audit.recordAction('submit signup form');
    await passwordInput.press('Enter');
    await waitForUiTransition(page, beforeRegistration, { action: 'submit signup form', timeoutMs: 20_000 });

    await page.waitForSelector('a[href*="/b/"], #main-menu-dropdown', { visible: true, timeout: 20_000 });
    await waitForUiStable(page, { action: 'load authenticated landscape root' });
    await assertDOMIntegrity(page, 'Landscape Map (Root)');
    await takeTimestampedScreenshot(page, roundDir, 0, step++, 'authenticated_landscape_root');

    // ----------------------------------------------------
    // BFS State Queues
    // ----------------------------------------------------
    const visitedUrls = new Set<string>();
    const normalizedRootUrl = '/zh-cn/landscape/';
    visitedUrls.add(normalizedRootUrl);
    visitedUrls.add('/zh-cn/');
    let currentQueue: BFSNode[] = [
      { url: normalizedRootUrl, name: 'Landscape Map', depth: 1, path: [] }
    ];

    for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
      console.log(`\n========================================================`);
      console.log(` [BFS LEVEL ${currentDepth}] Exploring ${currentQueue.length} Node(s) at Depth ${currentDepth}`);
      console.log(`========================================================`);

      const nextQueue: BFSNode[] = [];

      for (const node of currentQueue) {
        console.log(`\n>>> [BFS LEVEL ${currentDepth} NODE] Traversing: "${node.name}" (${node.url}) ...`);
        totalAttemptedPages++;

        try {
          await navigateByVisibleClicks(page, node.path, normalizedRootUrl, audit);
        } catch (navigationErr: unknown) {
          unreachableNodes++;
          unreachablePaths.add(node.url);
          runFailed = true;
          console.error(`  -> Navigation failed and node was excluded: ${node.url}`, navigationErr instanceof Error ? navigationErr.message : String(navigationErr));
          continue;
        }
        totalVisitedPages++;
        await waitForUiStable(page, { action: `load ${node.url}` });
        const integrity = await assertDOMIntegrity(page, node.name);
        console.log(`  -> Scientific DOM Check Passed (Visible elements: ${integrity.visibleCount}, Sample: "${integrity.snippet.slice(0, 60)}...")`);
        await takeTimestampedScreenshot(page, roundDir, currentDepth, step++, node.name);

        // ----------------------------------------------------
        // Step A: Discover and exercise non-destructive controls
        // ----------------------------------------------------
        const buttonHandles = await page.$$('button, div[role="button"], [class*="btn"]:not(a), [role="tab"]');
        const buttonDescriptors: Array<{ tag: string; text: string; role: string; expanded: string | null; isVisible: boolean; disabled: boolean }> = [];
        for (const button of buttonHandles) {
          const descriptor = await button.evaluate(el => ({
            tag: el.tagName,
            text: el.textContent?.trim().replace(/\s+/g, ' ') || '',
            role: el.getAttribute('role') || '',
            expanded: el.getAttribute('aria-expanded'),
            isVisible: el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0,
            disabled: (el as HTMLButtonElement).disabled === true
          }));
          if (
            descriptor.isVisible &&
            !descriptor.disabled &&
            descriptor.text.length > 0 &&
            !['登出', '删除', 'Demolish', 'Sign out', '重置', '全部接受'].some(k => descriptor.text.includes(k))
          ) {
            buttonDescriptors.push(descriptor);
          }
        }
        console.log(`  -> Found ${buttonDescriptors.length} actionable button/tab controls on current page.`);

        for (const descriptor of buttonDescriptors) {
          const buttonId = `${page.url()}::${descriptor.tag}::${descriptor.text}`;
          discoveredButtonIds.add(buttonId);
          // Tabs and declared disclosure controls are reversible UI navigation. Other buttons may
          // mutate money, inventory, or production, so list them as unverified without clicking.
          if (descriptor.role !== 'tab' && descriptor.expanded === null) {
            unverifiedButtonIds.add(buttonId);
            continue;
          }
          try {
            const currentButtons = await page.$$('button, div[role="button"], [class*="btn"]:not(a), [role="tab"]');
            let targetButton = null;
            for (const button of currentButtons) {
              const current = await button.evaluate(el => ({
                tag: el.tagName,
                text: el.textContent?.trim().replace(/\s+/g, ' ') || '',
                role: el.getAttribute('role') || '',
                expanded: el.getAttribute('aria-expanded'),
                visible: el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0,
                disabled: (el as HTMLButtonElement).disabled === true
              }));
              if (current.tag === descriptor.tag && current.text === descriptor.text && current.role === descriptor.role && current.expanded === descriptor.expanded && current.visible && !current.disabled) {
                targetButton = button;
                break;
              }
            }
            if (!targetButton) throw new Error(`Button was not found: ${buttonId}`);

            const before = await waitForUiStable(page, { action: `before ${buttonId}` });
            audit.recordAction(`click reversible UI control ${buttonId}`);
            await targetButton.click();
            await waitForUiTransition(page, before, { action: `click ${buttonId}` });
            exercisedButtonIds.add(buttonId);
          } catch (buttonErr: unknown) {
            failedButtonIds.add(buttonId);
            runFailed = true;
            console.error(`  -> Button failed and was excluded from coverage: ${buttonId}`, buttonErr instanceof Error ? buttonErr.message : String(buttonErr));
          }
        }

        // ----------------------------------------------------
        // Step B: Discover all Links on CURRENT page and Enqueue for next level
        // ----------------------------------------------------
        const linkUrls = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a[href]'));
          return links
            .map(a => ({
              href: a.getAttribute('href') || '',
              text: a.innerText?.trim().replace(/\s+/g, ' ') || ''
            }))
            .filter(item => {
              const h = item.href;
              return (
                h.startsWith('/zh-cn/') &&
                !h.includes('/signout/') &&
                !h.includes('/logout/') &&
                !h.includes('#') &&
                !h.endsWith('.png') &&
                !h.endsWith('.jpg') &&
                !h.endsWith('.mp4')
              );
            });
        });

        console.log(`  -> Discovered ${linkUrls.length} internal links on current page.`);

        for (const link of linkUrls) {
          const cleanPath = link.href.split('?')[0];
          if (!visitedUrls.has(cleanPath)) {
            visitedUrls.add(cleanPath);
            const linkName = link.text || cleanPath.replace('/zh-cn/', '');
            nextQueue.push({
              url: cleanPath,
              name: linkName,
              depth: currentDepth + 1,
              path: [...node.path, cleanPath]
            });
          }
        }
      }

      console.log(`\n--- [BFS LEVEL ${currentDepth} COMPLETE] Processed ${currentQueue.length} nodes. Next Level Queue: ${nextQueue.length} nodes. ---`);
      currentQueue = nextQueue;

      if (currentQueue.length === 0) {
        console.log('BFS Traversal reached natural leaf boundary.');
        break;
      }
    }

    const report = {
      pages: {
        attempted: totalAttemptedPages,
        visited: totalVisitedPages,
        unreachable: unreachableNodes,
        unreachablePaths: [...unreachablePaths]
      },
      buttons: {
        discovered: discoveredButtonIds.size,
        exercised: exercisedButtonIds.size,
        failed: failedButtonIds.size,
        failedIds: [...failedButtonIds]
      },
      runtimeErrors: audit.errors,
      unverifiedButtonIds: [...unverifiedButtonIds],
      audit: audit.snapshot(),
      stubs: {
        count: stubEndpoints.size,
        endpoints: [...stubEndpoints]
      }
    };
    fs.writeFileSync(path.join(roundDir, 'report.json'), JSON.stringify(report, null, 2));
    console.log('\n================================================================');
    console.log(' BREADTH-FIRST SEARCH (BFS) TRAVERSAL SUMMARY');
    console.log('================================================================');
    console.log(` Total Pages: attempted=${report.pages.attempted}, visited=${report.pages.visited}, unreachable=${report.pages.unreachable}`);
    console.log(` Buttons: discovered=${report.buttons.discovered}, exercised=${report.buttons.exercised}, failed=${report.buttons.failed}`);
    console.log(` Unverified mutation controls: ${unverifiedButtonIds.size}`);
    console.log(` Stub endpoints: ${report.stubs.count}`);
    report.stubs.endpoints.forEach(endpoint => console.log(`   - ${endpoint}`));
    console.log(` Total Browser Audit Errors: ${report.runtimeErrors.length}`);
    console.log('================================================================');

    audit.assertClean('BFS crawler');
    if (failedButtonIds.size > 0 || unreachableNodes > 0) runFailed = true;
    if (runFailed) throw new Error(`BFS traversal had ${failedButtonIds.size} failed UI control(s) and ${unreachableNodes} unreachable page(s).`);

    console.log('✅ BREADTH-FIRST SEARCH (BFS) TRAVERSAL COMPLETED SUCCESSFULLY WITH ZERO ERRORS!');
  } catch (err: unknown) {
    console.error('Fatal BFS Crawler error:', err instanceof Error ? err.message : String(err));
    await audit.writeFailureArtifacts(roundDir, 'bfs-failure');
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

runBFSCrawler(3);
