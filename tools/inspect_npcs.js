const puppeteer = require('puppeteer-core');

async function inspectNpcs() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.goto('http://localhost:3008/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));

  // Log in as 123456 to unlock packs
  await page.evaluate(async () => {
    const mod = System.get('chunks:///_virtual/NetTest.ts');
    await mod.NetTest.login('123456', '123456');
  });
  await new Promise(r => setTimeout(r, 3000));

  const client = await page.target().createCDPSession();
  const { result } = await client.send('Runtime.evaluate', {
    expression: 'System.get("chunks:///_virtual/City.ts").City.prototype.placeNpcs'
  });
  const { internalProperties } = await client.send('Runtime.getProperties', {
    objectId: result.objectId,
    generatePreview: true
  });
  const scopes = internalProperties.find(p => p.name === '[[Scopes]]');
  const scopeList = await client.send('Runtime.getProperties', {
    objectId: scopes.value.objectId
  });
  
  for (const s of scopeList.result) {
    const scopeObj = await client.send('Runtime.getProperties', {
      objectId: s.value.objectId
    });
    const npcFn = scopeObj.result.find(x => x.name === '_0x11a871');
    if (npcFn) {
      const evalRes = await client.send('Runtime.callFunctionOn', {
        objectId: npcFn.value.objectId,
        functionDeclaration: `function() {
          const fn = this;
          return fn('town_silver_knight');
        }`,
        returnByValue: true
      });
      console.log('Silver knight NPCs count:', evalRes.result.value ? evalRes.result.value.length : 0);
      console.log('Sample NPC:', evalRes.result.value ? evalRes.result.value.slice(0, 3) : null);
      break;
    }
  }
  await browser.close();
}
inspectNpcs().catch(console.error);
