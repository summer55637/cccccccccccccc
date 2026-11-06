const puppeteer = require('puppeteer-core');

async function testInteract() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 720, height: 1280 });

  page.on('console', msg => console.log('[Browser LOG]', msg.text()));

  await page.goto('http://localhost:3008/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));

  // Login
  await page.evaluate(async () => {
    const mod = System.get('chunks:///_virtual/NetTest.ts');
    await mod.NetTest.login('123456', '123456');
  });
  await new Promise(r => setTimeout(r, 3000));

  // Enter game
  await page.evaluate(() => {
    const modCS = System.get('chunks:///_virtual/CharSelect.ts');
    const CS = modCS.CharSelect.inst;
    if (CS) {
      CS.tapSlot(0);
      CS.mainAction();
    }
  });

  // Wait 3s for world to load
  await new Promise(r => setTimeout(r, 3000));

  // Click the "知道了" button (it's at center x: 360, y: 546)
  console.log('Clicking 知道了 button...');
  await page.mouse.click(360, 546);
  await new Promise(r => setTimeout(r, 1000));

  // Click to walk around town (e.g. click ground at x: 360, y: 400)
  console.log('Tapping ground to walk...');
  await page.mouse.click(360, 400);
  await new Promise(r => setTimeout(r, 2000));

  // Send a test chat message
  console.log('Sending chat message...');
  await page.evaluate(() => {
    const NT = System.get('chunks:///_virtual/NetTest.ts').NetTest;
    if (NT.inst && NT.inst.sock) {
      NT.inst.sock.raw('chat', { text: '哈囉小樹！伺服器運作正常！', chan: 'normal' });
    }
  });
  await new Promise(r => setTimeout(r, 1000));

  const postState = await page.evaluate(() => {
    const City = System.get('chunks:///_virtual/City.ts').City.inst;
    return {
      heroCell: City && City.lw && City.lw.hero ? [City.lw.hero.gx, City.lw.hero.gy] : null,
      isWalking: City && City.lw && City.lw.hero ? City.lw.isWalking(City.lw.hero) : false
    };
  });
  console.log('Post-interaction state:', postState);

  const screenshotPath = 'C:/Users/user/Desktop/小樹/tools/gameplay_active.png';
  await page.screenshot({ path: screenshotPath });
  console.log('Saved active gameplay screenshot to:', screenshotPath);

  await browser.close();
}

testInteract().catch(console.error);
