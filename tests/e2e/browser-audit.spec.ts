import { expect, test } from '@playwright/test';
import { attachBrowserAudit } from './support/browser-audit.ts';

test('BrowserAudit fails on an unhandled browser promise rejection', async ({ page }) => {
  const audit = attachBrowserAudit(page);
  await page.goto('/version/');
  await page.evaluate(() => {
    void Promise.reject(new Error('intentional BrowserAudit regression signal'));
  });

  await expect.poll(() => audit.errors.some(error => error.type === 'unhandledrejection')).toBe(true);
  expect(() => audit.assertClean('unhandled rejection regression')).toThrow(/\[unhandledrejection\]/);
});

test('BrowserAudit keeps similar local request and console errors fatal', async ({ page }) => {
  const audit = attachBrowserAudit(page);
  await page.goto('/version/');
  await page.evaluate(() => {
    console.error('Failed to load resource: net::ERR_NETWORK_ACCESS_DENIED');
    void fetch('/api/v2/__browser_audit_local_regression__/').then(response => {
      if (!response.ok) {
        const error = Object.assign(new Error('canceled'), { name: 'CanceledError' });
        throw error;
      }
    });
  });

  await expect.poll(() => audit.errors.some(error => error.type === 'console.error'
    && error.message === 'Failed to load resource: net::ERR_NETWORK_ACCESS_DENIED')).toBe(true);
  await expect.poll(() => audit.errors.some(error => error.type === 'api4xx')).toBe(true);
  await expect.poll(() => audit.errors.some(error => error.type === 'unhandledrejection'
    && error.message.includes('CanceledError: canceled'))).toBe(true);
  expect(() => audit.assertClean('similar local failures regression')).toThrow(/\[BROWSER_AUDIT_FAILURE\]/);
});

test('BrowserAudit does not ignore a review-widget-shaped rejection without its observed aborted request', async ({ page }) => {
  const audit = attachBrowserAudit(page);
  await page.goto('/zh-cn/');
  await page.evaluate(() => {
    const error = new Error('canceled');
    error.name = 'CanceledError';
    error.stack = [
      'CanceledError: canceled',
      '    at Object.cancel (https://static.example.test/static/bundle/assets/index-regression.js:97:5276)',
      '    at https://static.example.test/static/bundle/assets/index-regression.js:1709:95653',
    ].join('\n');
    void Promise.reject(error);
  });

  await expect.poll(() => audit.errors.some(error => error.type === 'unhandledrejection'
    && error.message.includes('CanceledError: canceled'))).toBe(true);
  expect(() => audit.assertClean('unpaired optional-widget cancellation regression')).toThrow(/\[BROWSER_AUDIT_FAILURE\]/);
});
