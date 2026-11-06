const puppeteer = require('puppeteer-core');

async function deobfCS() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.goto('http://localhost:3008/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));

  const code = await page.evaluate(() => {
    const CS = System.get('chunks:///_virtual/CharSelect.ts').CharSelect;
    return CS.prototype.mainAction.toString();
  });
  console.log('mainAction:\n', code);
  await browser.close();
}
deobfCS().catch(console.error);
