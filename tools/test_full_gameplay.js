const puppeteer = require('puppeteer-core');

async function testFullGameplay() {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 720, height: 1280 });

  page.on('console', msg => console.log('[Browser LOG]', msg.text()));
  page.on('pageerror', err => console.log('[Browser ERR]', err.message));

  console.log('Opening http://localhost:3008/ ...');
  await page.goto('http://localhost:3008/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));

  console.log('Logging in as 123456...');
  await page.evaluate(async () => {
    const mod = System.get('chunks:///_virtual/NetTest.ts');
    await mod.NetTest.login('123456', '123456');
  });

  console.log('Waiting for packs to decrypt and character selection to appear...');
  await new Promise(r => setTimeout(r, 3500));

  // Hook socket events for debugging
  await page.evaluate(() => {
    const mod = System.get('chunks:///_virtual/NetTest.ts');
    const sock = mod.NetTest.inst.sock;
    if (sock && sock.ws) {
      sock.ws.addEventListener('close', (e) => {
        console.log('[WS CLOSED]', 'code:', e.code, 'reason:', e.reason);
      });
      sock.ws.addEventListener('error', (e) => {
        console.log('[WS ERROR]', e);
      });
    }
  });

  console.log('Triggering mainAction to enter game with character [0]...');
  await page.evaluate(() => {
    const modCS = System.get('chunks:///_virtual/CharSelect.ts');
    const CS = modCS.CharSelect.inst;
    if (CS) {
      CS.tapSlot(0);
      CS.mainAction();
    }
  });

  // Wait 4 seconds for world enter and transition
  console.log('Waiting 4s for world loading and transition...');
  await new Promise(r => setTimeout(r, 4000));

  const gameCheck = await page.evaluate(() => {
    const modCS = System.get('chunks:///_virtual/CharSelect.ts');
    const modCity = System.get('chunks:///_virtual/City.ts');
    const CS = modCS.CharSelect.inst;
    const City = modCity.City.inst;

    return {
      charSelectActive: CS && CS.root ? CS.root.active : null,
      cityMapReady: City ? City.mapReady : null,
      cityHeroSynced: City ? City.heroSynced : null,
      hasSnap: City ? !!City.snap : null,
      hasHero: City && City.lw ? !!City.lw.hero : null,
      heroPos: City && City.lw && City.lw.hero ? [City.lw.hero.gx, City.lw.hero.gy] : null,
      inWorld: City ? City.inWorld : null
    };
  });

  console.log('Game state check:', JSON.stringify(gameCheck, null, 2));

  // Take screenshot of game world
  const screenshotPath = 'C:/Users/user/Desktop/小樹/tools/in_game_play.png';
  await page.screenshot({ path: screenshotPath });
  console.log('Saved gameplay screenshot to:', screenshotPath);

  await browser.close();
}

testFullGameplay().catch(console.error);
