// DOM 回归:全部操作经可见 DOM/鼠标完成;window.__voxel 只读,用于把格子坐标投影到屏幕与断言。
// 运行:node game3d/tests/dom.e2e.mjs(需 playwright 或 @playwright/test;CHROMIUM_PATH 可指定浏览器)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const pw = await import('playwright-core').catch(() => import('@playwright/test'));
const { chromium } = pw;
const PORT = 3291;
const server = spawn(process.execPath, [fileURLToPath(new URL('../serve.mjs', import.meta.url)), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let failed = false;
try {
  await page.goto(`http://127.0.0.1:${PORT}/index.html?new=1`);
  await page.getByRole('button', { name: '开始游戏' }).click();

  // 1) 选择「采集 → 农场」,在指挥中心南侧道路旁放置
  await page.locator('.cat[data-cat="raw"]').click();
  await page.locator('.card[data-type="farm"]').click();
  await page.waitForFunction(() => document.querySelector('.card[data-type="farm"]').classList.contains('on'));
  const target = await page.evaluate(() => {
    const { game } = window.__voxel;
    const hq = game.playerHQ();
    for (let z = hq.z + 4; z < hq.z + 8; z++) {
      for (let x = hq.x - 2; x < hq.x + 6; x++) if (game.canPlace('farm', x, z).ok) return { x: x + 1, z: z + 1 };
    }
    return null;
  });
  assert.ok(target, '应存在可放置农场的位置');
  const p = await page.evaluate(({ x, z }) => window.__voxel.project(x, z), target);
  const money0 = await page.evaluate(() => window.__voxel.game.res.money);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await page.locator('#panel h2', { hasText: '农场' }).waitFor();
  assert.equal(await page.evaluate(() => window.__voxel.game.res.money), money0 - 50, '应精确扣除 50 金币');

  // 2) 4 倍速,等待建成并产出谷物(资源条出现 🌾)
  await page.locator('#speed button[data-speed="4"]').click();
  await page.locator('#resbar .res', { hasText: '🌾' }).waitFor({ timeout: 20000 });

  // 3) 打开科技树并关闭
  await page.locator('#btn-tech').click();
  await page.locator('.dialog[data-modal="tech"]').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#modal').isHidden(), true);

  // 4) 刷新后存档恢复(保存走菜单 DOM)
  await page.locator('#btn-menu').click();
  await page.getByRole('button', { name: '💾 立即保存' }).click();
  const farms = await page.evaluate(() => [...window.__voxel.game.buildings.values()].filter((b) => b.type === 'farm').length);
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForFunction(() => window.__voxel?.game);
  const farmsAfter = await page.evaluate(() => [...window.__voxel.game.buildings.values()].filter((b) => b.type === 'farm').length);
  assert.equal(farmsAfter, farms, '刷新后农场应保留');

  assert.deepEqual(errors, [], `控制台错误:\n${errors.join('\n')}`);
  console.log('✅ DOM 回归通过');
} catch (e) {
  failed = true;
  console.error('❌', e.message);
  await page.screenshot({ path: 'test-results/game3d-e2e-failure.png' }).catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
