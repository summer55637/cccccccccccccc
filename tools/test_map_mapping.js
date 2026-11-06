const puppeteer = require('puppeteer-core');

async function testMapMapping() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.goto('http://localhost:3008/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));

  const client = await page.target().createCDPSession();
  const { result } = await client.send('Runtime.evaluate', {
    expression: 'System.get("chunks:///_virtual/City.ts").City.prototype.onSnap'
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
    const mapFn = scopeObj.result.find(x => x.name === '_0x45a98b');
    if (mapFn) {
      console.log('Found _0x45a98b!');
      const evalRes = await client.send('Runtime.callFunctionOn', {
        objectId: mapFn.value.objectId,
        functionDeclaration: `function() {
          const fn = this;
          const testMaps = ['town_silver_knight', 'map0', 'lin_map0', 'training', 'cave1', 'map4', 'silver_knight'];
          const out = {};
          for (const m of testMaps) {
            out[m] = fn(m);
          }
          return out;
        }`,
        returnByValue: true
      });
      console.log('Map pack mappings:\n', JSON.stringify(evalRes.result.value, null, 2));
      break;
    }
  }
  await browser.close();
}
testMapMapping().catch(console.error);
