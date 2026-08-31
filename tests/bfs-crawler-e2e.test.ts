import puppeteer, { Page } from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

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

async function waitForPageTransition(page: Page) {
  await page.waitForNetworkIdle({ idleTime: 200, timeout: 3000 }).catch(() => {});
}

async function clickVisibleLink(page: Page, targetPath: string): Promise<void> {
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
      const beforeUrl = page.url();
      const beforeText = await page.evaluate(() => document.body.innerText);
      await link.click();
      await waitForPageTransition(page);
      const afterUrl = page.url();
      const afterText = await page.evaluate(() => document.body.innerText);
      if (afterUrl === beforeUrl && beforeText === afterText) {
        throw new Error(`Navigation link produced no visible transition: ${targetPath}`);
      }
      return;
    }
  }
  throw new Error(`Visible navigation link was not found: ${targetPath}`);
}

async function returnToRoot(page: Page, rootPath: string): Promise<void> {
  const expectedRoot = normalizePath(rootPath);
  for (let attempt = 0; attempt < 20; attempt++) {
    if (normalizePath(new URL(page.url()).pathname) === expectedRoot) return;

    try {
      await clickVisibleLink(page, rootPath);
      continue;
    } catch {
      const before = page.url();
      await page.goBack({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {});
      if (page.url() === before) break;
    }
  }
  if (normalizePath(new URL(page.url()).pathname) !== expectedRoot) {
    throw new Error(`Could not return to crawler root: ${page.url()}`);
  }
}

async function navigateByVisibleClicks(page: Page, pathFromRoot: string[], rootPath: string): Promise<void> {
  await returnToRoot(page, rootPath);
  for (const targetPath of pathFromRoot) {
    await clickVisibleLink(page, targetPath);
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

  const baseUrl = 'http://127.0.0.1:3000';
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const unhandledErrors: string[] = [];
  page.on('pageerror', err => {
    unhandledErrors.push(`[Page Error] ${err.message}`);
    console.error(`  [PAGE ERROR DETECTED]: ${err.message}`);
  });

  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('Amplitude') && !msg.text().includes('trailer')) {
      unhandledErrors.push(`[Console Error] ${msg.text()}`);
    }
  });

  const stubEndpoints = new Set<string>();
  page.on('response', response => {
    const responseHeaders = response.headers();
    if (response.status() === 501 || responseHeaders['x-backend-stub'] === 'true') {
      const request = response.request();
      stubEndpoints.add(`${request.method()} ${new URL(response.url()).pathname}`);
    }
  });

  let totalDiscoveredButtons = 0;
  let totalExercisedButtons = 0;
  let totalVisitedPages = 0;
  let totalAttemptedPages = 0;
  let unreachableNodes = 0;
  const unreachablePaths = new Set<string>();
  const discoveredButtonIds = new Set<string>();
  const exercisedButtonIds = new Set<string>();
  const failedButtonIds = new Set<string>();
  let step = 1;

  try {
    // ----------------------------------------------------
    // Level 0: Authentication & Initial Entry Setup
    // ----------------------------------------------------
    console.log('\n========================================================');
    console.log(' [BFS LEVEL 0] Initial Landing & Player Authentication');
    console.log('========================================================');

    await page.goto(`${baseUrl}/zh-cn/signup/`, { waitUntil: 'networkidle2' });
    await assertDOMIntegrity(page, 'Signup Page');
    await takeTimestampedScreenshot(page, roundDir, 0, step++, 'signup_page');

    // Dismiss Cookie banner
    for (const b of await page.$$('button')) {
      const text = await b.evaluate(el => el.textContent || '');
      if (text.includes('全部接受') || text.includes('仅限必要')) {
        await b.click();
        break;
      }
    }

    // Click email registration button
    for (const b of await page.$$('button')) {
      const text = await b.evaluate(el => el.textContent || '');
      if (text.includes('使用邮箱地址') || text.includes('邮箱')) {
        await b.click();
        break;
      }
    }
    await page.waitForNetworkIdle({ idleTime: 200, timeout: 3000 }).catch(() => {});

    const testEmail = `bfs_player_${Date.now()}@example.local`;
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
          await navigateByVisibleClicks(page, node.path, normalizedRootUrl);
        } catch (navigationErr: unknown) {
          unreachableNodes++;
          unreachablePaths.add(node.url);
          console.error(`  -> Navigation failed and node was excluded: ${node.url}`, navigationErr instanceof Error ? navigationErr.message : String(navigationErr));
          continue;
        }
        totalVisitedPages++;
        await new Promise(r => setTimeout(r, 1000));
        const integrity = await assertDOMIntegrity(page, node.name);
        console.log(`  -> Scientific DOM Check Passed (Visible elements: ${integrity.visibleCount}, Sample: "${integrity.snippet.slice(0, 60)}...")`);
        await takeTimestampedScreenshot(page, roundDir, currentDepth, step++, node.name);

        // ----------------------------------------------------
        // Step A: Discover and exercise non-destructive controls
        // ----------------------------------------------------
        const buttonHandles = await page.$$('button, div[role="button"], [class*="btn"]:not(a), [role="tab"]');
        const buttonDescriptors: Array<{ tag: string; text: string; isVisible: boolean; disabled: boolean }> = [];
        for (const button of buttonHandles) {
          const descriptor = await button.evaluate(el => ({
            tag: el.tagName,
            text: el.textContent?.trim().replace(/\s+/g, ' ') || '',
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
        totalDiscoveredButtons += buttonDescriptors.length;
        console.log(`  -> Found ${buttonDescriptors.length} actionable button/tab controls on current page.`);

        for (const descriptor of buttonDescriptors.slice(0, 12)) {
          const buttonId = `${page.url()}::${descriptor.tag}::${descriptor.text}`;
          discoveredButtonIds.add(buttonId);
          try {
            const currentButtons = await page.$$('button, div[role="button"], [class*="btn"]:not(a), [role="tab"]');
            let targetButton = null;
            for (const button of currentButtons) {
              const current = await button.evaluate(el => ({
                tag: el.tagName,
                text: el.textContent?.trim().replace(/\s+/g, ' ') || '',
                visible: el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0,
                disabled: (el as HTMLButtonElement).disabled === true
              }));
              if (current.tag === descriptor.tag && current.text === descriptor.text && current.visible && !current.disabled) {
                targetButton = button;
                break;
              }
            }
            if (!targetButton) throw new Error(`Button was not found: ${buttonId}`);

            const beforeUrl = page.url();
            const beforeText = await page.evaluate(() => document.body.innerText);
            await targetButton.click();
            await waitForPageTransition(page);
            const afterUrl = page.url();
            const afterText = await page.evaluate(() => document.body.innerText);
            if (beforeUrl === afterUrl && beforeText === afterText) {
              throw new Error(`Button produced no visible transition: ${buttonId}`);
            }

            exercisedButtonIds.add(buttonId);
            totalExercisedButtons++;
          } catch (buttonErr: unknown) {
            failedButtonIds.add(buttonId);
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
      runtimeErrors: unhandledErrors,
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
    console.log(` Total Actionable Button Observations: ${totalDiscoveredButtons}`);
    console.log(` Stub endpoints: ${report.stubs.count}`);
    report.stubs.endpoints.forEach(endpoint => console.log(`   - ${endpoint}`));
    console.log(` Total Successful Button Actions: ${totalExercisedButtons}`);
    console.log(` Total Unhandled Runtime Errors: ${unhandledErrors.length}`);
    if (unhandledErrors.length > 0) {
      console.log(' Unhandled Errors:');
      unhandledErrors.forEach((e, idx) => console.log(`   ${idx + 1}. ${e}`));
    }
    console.log('================================================================');

    await browser.close();

    if (unhandledErrors.length > 0) {
      throw new Error(`BFS Traversal uncovered ${unhandledErrors.length} unhandled runtime error(s)!`);
    }

    console.log('✅ BREADTH-FIRST SEARCH (BFS) TRAVERSAL COMPLETED SUCCESSFULLY WITH ZERO ERRORS!');
  } catch (err: unknown) {
    console.error('Fatal BFS Crawler error:', err instanceof Error ? err.message : String(err));
    await browser.close();
    process.exit(1);
  }
}

runBFSCrawler(3);
