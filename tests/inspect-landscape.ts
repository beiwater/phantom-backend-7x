import puppeteer from 'puppeteer';
import path from 'node:path';

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  console.log('Navigating directly to http://127.0.0.1:3000/zh-cn/landscape/ ...');
  await page.goto('http://127.0.0.1:3000/zh-cn/landscape/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 4000));

  const pageData = await page.evaluate(() => {
    const allLinks = Array.from(document.querySelectorAll('a, button')).map(el => ({
      tag: el.tagName,
      text: el.innerText?.trim() || '',
      href: el.getAttribute('href') || '',
      class: el.className
    })).filter(e => e.text.length > 0);

    const images = Array.from(document.querySelectorAll('img')).map(el => ({
      src: el.getAttribute('src') || '',
      alt: el.getAttribute('alt') || '',
      class: el.className
    }));

    return {
      title: document.title,
      links: allLinks,
      imageCount: images.length,
      imageSample: images.slice(0, 10),
      bodyText: document.body.innerText.slice(0, 600)
    };
  });

  console.log('Page Title:', pageData.title);
  console.log('Interactive Elements count:', pageData.links.length);
  console.log('Sample links:');
  pageData.links.slice(0, 20).forEach(l => console.log(`  [${l.tag}] "${l.text}" (href: ${l.href})`));
  console.log('Image Sample:');
  pageData.imageSample.forEach(img => console.log(`  img src: ${img.src}`));
  console.log('\nBody text snippet:\n', pageData.bodyText);

  await page.screenshot({ path: path.resolve('screenshots/landscape_full.png'), fullPage: true });
  console.log('Saved landscape_full.png');

  await browser.close();
}

main();
