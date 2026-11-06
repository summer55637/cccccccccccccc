const puppeteer = require('puppeteer-core');
const fs = require('fs');

async function run() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 720, height: 1280 });

  page.on('console', msg => {
    console.log(`[Browser Console ${msg.type().toUpperCase()}]`, msg.text());
  });

  page.on('pageerror', err => {
    console.error('[Browser PageError]', err.toString());
  });

  page.on('requestfailed', req => {
    console.error('[Browser Request Failed]', req.url(), req.failure() ? req.failure().errorText : '');
  });

  page.on('response', res => {
    if (res.status() >= 400) {
      console.error(`[Browser HTTP ${res.status()}]`, res.url());
    }
  });

  console.log('Navigating to http://localhost:3008/ ...');
  try {
    await page.goto('http://localhost:3008/', { waitUntil: 'networkidle2', timeout: 15000 });
  } catch (e) {
    console.log('Navigation ended / timeout:', e.message);
  }

  // Wait a few seconds to let Cocos finish init
  await new Promise(r => setTimeout(r, 4000));

  await page.screenshot({ path: 'C:/Users/user/Desktop/小樹/tools/screenshot.png' });
  console.log('Screenshot saved to tools/screenshot.png');

  await browser.close();
}

run().catch(err => {
  console.error('Diagnostic error:', err);
  process.exit(1);
});
