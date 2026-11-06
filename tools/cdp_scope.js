const puppeteer = require('puppeteer-core');

async function inspectScope() {
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
    accessorPropertiesOnly: false,
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
    const fnProp = scopeObj.result.find(x => x.name === '_0x534029');
    if (fnProp) {
      // Let's get the source of onSnap and ensureHero, and replace all calls to string decoders!
      const codeRes = await client.send('Runtime.callFunctionOn', {
        objectId: fnProp.value.objectId,
        functionDeclaration: `function() {
          const dec = this;
          const C = System.get("chunks:///_virtual/City.ts").City;
          
          function deobf(fnStr) {
            // Replace _0x5e6cb6 or other helper calls if possible
            // Let's replace any helper calls that call dec
            return fnStr;
          }
          return {
            onSnapStr: C.prototype.onSnap.toString(),
            ensureHeroStr: C.prototype.ensureHero.toString(),
            loadOkStr: C.prototype.loadOk.toString(),
            loadMapIntoStr: C.prototype.loadMapInto.toString()
          };
        }`,
        returnByValue: true
      });
      console.log('onSnap:\n', codeRes.result.value.onSnapStr);
      console.log('ensureHero:\n', codeRes.result.value.ensureHeroStr);
      console.log('loadOk:\n', codeRes.result.value.loadOkStr);
      console.log('loadMapInto:\n', codeRes.result.value.loadMapIntoStr);
      break;
    }
  }
  await browser.close();
}
inspectScope().catch(console.error);
