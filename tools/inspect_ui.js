const puppeteer = require('puppeteer-core');

async function run() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 720, height: 1280 });

  page.on('console', msg => console.log(`[Browser LOG]`, msg.text()));
  page.on('pageerror', err => console.log(`[Browser ERR]`, err.message));

  await page.goto('http://localhost:3008/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 4000));

  const domInfo = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input, button, a, div')).map(el => {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        id: el.id,
        className: el.className,
        text: el.innerText || el.value || '',
        w: rect.width,
        h: rect.height,
        visible: rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none'
      };
    }).filter(x => x.visible && (x.text || x.tag === 'INPUT' || x.tag === 'BUTTON' || x.id));
    return {
      title: document.title,
      inputs
    };
  });

  console.log('DOM Info:', JSON.stringify(domInfo, null, 2));

  await page.screenshot({ path: 'C:/Users/user/Desktop/小樹/tools/current_ui.png' });
  await browser.close();
}

run().catch(console.error);
