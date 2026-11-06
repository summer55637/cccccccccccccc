const puppeteer = require('puppeteer-core');

async function testNewPlayerFlow() {
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

  // 1. Register new account
  console.log('Registering player999...');
  const regResult = await page.evaluate(async () => {
    const mod = System.get('chunks:///_virtual/NetTest.ts');
    return await mod.NetTest.register('player999', '123456');
  });
  console.log('Reg result:', regResult);
  await new Promise(r => setTimeout(r, 2500));

  // 2. Create Character '小樹法師'
  console.log('Creating character 小樹法師 (mage)...');
  await page.evaluate(async () => {
    const mod = System.get('chunks:///_virtual/NetTest.ts');
    mod.NetTest.createChar(0, '小樹法師', 'mage', 'f', {
      str: 8, dex: 7, con: 12, int: 18, wis: 16, cha: 8
    });
  });
  await new Promise(r => setTimeout(r, 2500));

  // 3. Select character and enter game
  console.log('Selecting slot 0 and entering game...');
  await page.evaluate(() => {
    const modCS = System.get('chunks:///_virtual/CharSelect.ts');
    const CS = modCS.CharSelect.inst;
    if (CS) {
      CS.tapSlot(0);
      CS.mainAction();
    }
  });

  // Wait 4s for world entry
  await new Promise(r => setTimeout(r, 4000));

  const status = await page.evaluate(() => {
    const City = System.get('chunks:///_virtual/City.ts').City.inst;
    const CS = System.get('chunks:///_virtual/CharSelect.ts').CharSelect.inst;
    return {
      charSelectActive: CS && CS.root ? CS.root.active : null,
      inWorld: City ? City.inWorld : null,
      heroSynced: City ? City.heroSynced : null,
      heroPos: City && City.lw && City.lw.hero ? [City.lw.hero.gx, City.lw.hero.gy] : null,
      mapId: City ? City.mapId : null
    };
  });
  console.log('New player flow status:', JSON.stringify(status, null, 2));

  // Dismiss modal
  await page.mouse.click(360, 546);
  await new Promise(r => setTimeout(r, 1000));

  const screenshotPath = 'C:/Users/user/Desktop/小樹/tools/new_player_world.png';
  await page.screenshot({ path: screenshotPath });
  console.log('Saved new player screenshot to:', screenshotPath);

  await browser.close();
}

testNewPlayerFlow().catch(console.error);
