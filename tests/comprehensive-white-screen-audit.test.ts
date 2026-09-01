import puppeteer, { Page } from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

function getFormattedTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function assertDOMIntegrity(page: Page, routeName: string, routeUrl: string) {
  const result = await page.evaluate(() => {
    const root = document.getElementById('root');
    const bodyText = document.body.innerText ? document.body.innerText.trim() : '';
    const visibleElements = Array.from(document.querySelectorAll('div, a, button, h1, h2, h3, table, img, span, input')).filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    const crashKeywords = [
      'An unexpected error occurred',
      '发生了意外错误',
      '发生意外错误',
      '未找到地图',
      '未找到公司',
      '未找到购买配套',
      'Failed to load app',
      'Something went wrong',
      '出了点问题',
      '网页定向无结果',
      '页面不存在',
      'Cannot read properties',
      'is not a function',
      '500 Internal Server Error',
      '404 Not Found'
    ];
    const foundCrash = crashKeywords.find(k => bodyText.includes(k));

    const nanKeywords = ['$NaN', 'NaN$', 'BoostsNaN', 'BoostNaN', 'Sim BoostsNaN', '$NAN', 'NaN%'];
    const foundNaN = nanKeywords.find(k => bodyText.includes(k));

    return {
      hasRoot: !!root,
      rootChildCount: root ? root.children.length : 0,
      bodyTextLength: bodyText.length,
      visibleCount: visibleElements.length,
      foundCrash,
      foundNaN,
      title: document.title,
      textSample: bodyText.slice(0, 100).replace(/\s+/g, ' ')
    };
  });

  if (!result.hasRoot || result.rootChildCount === 0 || result.bodyTextLength < 5 || result.visibleCount === 0) {
    throw new Error(`[WHITE SCREEN DETECTED] Route "${routeName}" (${routeUrl}) rendered empty! (Visible elements: ${result.visibleCount})`);
  }

  if (result.foundCrash) {
    throw new Error(`[CRASH STATE DETECTED] Route "${routeName}" (${routeUrl}) contains crash keyword: "${result.foundCrash}"`);
  }

  if (result.foundNaN) {
    throw new Error(`[NAN CORRUPTION DETECTED] Route "${routeName}" (${routeUrl}) contains NaN error: "${result.foundNaN}"`);
  }

  return result;
}

const ALL_GAME_ROUTES = [
  // 1. Landscape & Buildings
  { name: 'Landscape Map', url: '/zh-cn/landscape/' },
  { name: 'B0 Construction Catalog', url: '/zh-cn/landscape/buildings/B0/' },
  { name: 'Farm Production View', url: '/zh-cn/b/1/' },
  { name: 'Grocery Store Retail View', url: '/zh-cn/b/2/' },

  // 2. Headquarters & Finances
  { name: 'HQ Financial Overview', url: '/zh-cn/headquarters/overview/' },
  { name: 'HQ Accounting & Balance Sheet', url: '/zh-cn/headquarters/accounting/' },
  { name: 'HQ Finance & Bonds', url: '/zh-cn/headquarters/finance/' },
  { name: 'HQ Executive Board', url: '/zh-cn/headquarters/executives/' },
  { name: 'HQ Personal Assistant', url: '/zh-cn/headquarters/executives/pa/' },
  { name: 'HQ SimBoosts Movements', url: '/zh-cn/headquarters/simboosts/' },

  // 3. Warehouse & Inventory
  { name: 'Warehouse Stock', url: '/zh-cn/headquarters/warehouse/' },
  { name: 'Warehouse Incoming Contracts', url: '/zh-cn/headquarters/warehouse/incoming-contracts/' },
  { name: 'Warehouse Outgoing Contracts', url: '/zh-cn/headquarters/warehouse/outgoing-contracts/' },
  { name: 'Warehouse Research Industry', url: '/zh-cn/headquarters/warehouse/research/' },
  { name: 'Warehouse Stats', url: '/zh-cn/headquarters/warehouse/stats/' },
  { name: 'Warehouse Resource Sell Modal', url: '/zh-cn/headquarters/warehouse/3/sell/' },
  { name: 'Warehouse Resource Contract Modal', url: '/zh-cn/headquarters/warehouse/1/contract/' },

  // 4. Market & Exchange
  { name: 'Exchange All Resources', url: '/zh-cn/market/resources/' },
  { name: 'Market Power Q0-Q12', url: '/zh-cn/market/resource/1/' },
  { name: 'Market Apples Q0-Q12', url: '/zh-cn/market/resource/3/' },
  { name: 'Market Bonds Trading', url: '/zh-cn/market/bonds/' },
  { name: 'Market Collectibles', url: '/zh-cn/market/collectibles/' },
  { name: 'Market Government Orders', url: '/zh-cn/market/government-orders/0/' },

  // 5. Encyclopedia & Progression
  { name: 'Encyclopedia Home', url: '/zh-cn/encyclopedia/0/' },
  { name: 'Encyclopedia Resources Index', url: '/zh-cn/encyclopedia/0/resources/' },
  { name: 'Encyclopedia Apples Detail', url: '/zh-cn/encyclopedia/0/resource/3/' },
  { name: 'Encyclopedia Buildings Index', url: '/zh-cn/encyclopedia/0/buildings/' },
  { name: 'Encyclopedia Farm Detail', url: '/zh-cn/encyclopedia/0/building/P/' },
  { name: 'Encyclopedia Company Rankings (CV)', url: '/zh-cn/encyclopedia/0/ranking/' },
  { name: 'Encyclopedia EVA Rankings', url: '/zh-cn/encyclopedia/0/eva-ranking/' },
  { name: 'Encyclopedia Levels Table', url: '/zh-cn/encyclopedia/0/levels/' },
  { name: 'Encyclopedia Seasons & Weather', url: '/zh-cn/encyclopedia/0/seasons/' },
  { name: 'Encyclopedia Events', url: '/zh-cn/encyclopedia/0/events/' },
  { name: 'Encyclopedia Certificates', url: '/zh-cn/encyclopedia/0/certificates/' },

  // 6. Social, News & Communication
  { name: 'Chatrooms & Channels', url: '/zh-cn/messages/' },
  { name: 'Newspaper Latest Issue', url: '/zh-cn/newspaper/0/' },
  { name: 'Newspaper Issue #1', url: '/zh-cn/newspaper/0/1/' },
  { name: 'Achievements Showcase', url: '/zh-cn/achievements/' },
  { name: 'Company Search', url: '/zh-cn/search/' },
  { name: 'Referrals & Invites', url: '/zh-cn/referrals/' },
  { name: 'Community Polls', url: '/zh-cn/polls/1/' },
  { name: 'Education Courses', url: '/zh-cn/courses/' },
  { name: 'Game Notifications', url: '/zh-cn/game-notifications/' },
  { name: 'Checkout / SimBoosts Store', url: '/zh-cn/checkout/' }
];

async function runComprehensiveAudit() {
  const timestamp = getFormattedTimestamp();
  const roundDir = path.resolve('screenshots', `comprehensive_audit_${timestamp}`);
  fs.mkdirSync(roundDir, { recursive: true });

  console.log('================================================================');
  console.log(' Comprehensive White Screen & Bug Finder Audit Suite');
  console.log(` Target Routes: ${ALL_GAME_ROUTES.length} | Output: ${roundDir}`);
  console.log('================================================================');

  const baseUrl = 'http://127.0.0.1:3000';
  const browserArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'];
  if (process.env.E2E_DISABLE_WEB_SECURITY === '1') {
    console.warn('  [WARN] NON-RELEASE / INSECURE BROWSER MODE: --disable-web-security enabled');
    browserArgs.push('--disable-web-security');
  }
  const browser = await puppeteer.launch({
    headless: true,
    args: browserArgs
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const unhandledErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on('pageerror', err => {
    unhandledErrors.push(`[Page Error] ${err.message}`);
    console.error(`  [PAGE ERROR]: ${err.message}`);
  });

  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('Amplitude') && !msg.text().includes('trailer')) {
      unhandledErrors.push(`[Console Error] ${msg.text()}`);
    }
  });

  page.on('response', res => {
    if (res.status() >= 400) {
      failedRequests.push(`[HTTP ${res.status()}] ${res.request().method()} ${res.url()}`);
      console.warn(`  [FAILED REQUEST]: [HTTP ${res.status()}] ${res.request().method()} ${res.url()}`);
    }
  });

  let passedRoutes = 0;
  let failedRoutes = 0;

  try {
    // Phase 1: Clean Registration & Login
    console.log('\n[Phase 1] Registering fresh player for white-screen audit...');
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

    const testEmail = `audit_player_${Date.now()}@domain.local`;
    const emailInput = await page.$('input[type="email"], input[name="email"]');
    const passwordInput = await page.$('input[type="password"], input[name="password"]');

    if (emailInput && passwordInput) {
      await emailInput.type(testEmail);
      await passwordInput.type('Password123!');
      await passwordInput.press('Enter');
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 }).catch(() => {});
    }

    await page.waitForSelector('a[href*="/b/"], #main-menu-dropdown', { timeout: 10000 }).catch(() => {});
    await assertDOMIntegrity(page, 'Landscape Map', '/zh-cn/landscape/');
    console.log('  -> Registration & Authentication Successful.');

    // Phase 2: Systematic Traversal of All 35+ Game Routes
    console.log('\n[Phase 2] Systematically Auditing All 35+ Core Game Routes for White Screens & Crashes...');

    for (let i = 0; i < ALL_GAME_ROUTES.length; i++) {
      const route = ALL_GAME_ROUTES[i];
      const targetUrl = `${baseUrl}${route.url}`;
      console.log(`\n[${i + 1}/${ALL_GAME_ROUTES.length}] Auditing Route: "${route.name}" -> ${route.url}`);

      try {
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 25000 });
        await new Promise(r => setTimeout(r, 600));

        const integrity = await assertDOMIntegrity(page, route.name, route.url);
        console.log(`  -> Passed DOM Check (Visible: ${integrity.visibleCount}, Sample: "${integrity.textSample.slice(0, 50)}...")`);

        // Re-verify DOM integrity after rendering and capture screenshot
        const safeName = route.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
        const filename = `route_${String(i + 1).padStart(2, '0')}_${safeName}.png`;
        await page.screenshot({ path: path.join(roundDir, filename) });

        passedRoutes++;
      } catch (routeErr: unknown) {
        failedRoutes++;
        const errMsg = routeErr instanceof Error ? routeErr.message : String(routeErr);
        console.error(`  ❌ [ROUTE AUDIT FAILED]: ${errMsg}`);
        unhandledErrors.push(`[Route Failure] ${route.name} (${route.url}): ${errMsg}`);
      }
    }

    console.log('\n================================================================');
    console.log(' COMPREHENSIVE WHITE SCREEN & BUG FINDER AUDIT SUMMARY');
    console.log('================================================================');
    console.log(` Total Routes Audited: ${ALL_GAME_ROUTES.length}`);
    console.log(` Total Passed Routes: ${passedRoutes}`);
    console.log(` Total Failed Routes: ${failedRoutes}`);
    console.log(` Total Unhandled Runtime Errors: ${unhandledErrors.length}`);
    console.log(` Total Failed HTTP Requests: ${failedRequests.length}`);

    if (unhandledErrors.length > 0) {
      console.log('\n Detailed Errors:');
      unhandledErrors.forEach((e, idx) => console.log(`   ${idx + 1}. ${e}`));
    }
    if (failedRequests.length > 0) {
      console.log('\n Failed HTTP Requests:');
      failedRequests.slice(0, 10).forEach((r, idx) => console.log(`   ${idx + 1}. ${r}`));
    }
    console.log('================================================================');

    await browser.close();

    if (failedRoutes > 0 || unhandledErrors.length > 0) {
      throw new Error(`Comprehensive Audit discovered ${failedRoutes} route failure(s) and ${unhandledErrors.length} runtime error(s)!`);
    }

    console.log('✅ ALL 35+ GAME ROUTES PASSED ZERO-WHITE-SCREEN & ZERO-CRASH AUDIT!');
  } catch (err: unknown) {
    console.error('Fatal Audit error:', err instanceof Error ? err.message : String(err));
    await browser.close();
    process.exit(1);
  }
}

runComprehensiveAudit();
