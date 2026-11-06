const puppeteer = require('puppeteer-core');

async function fullDeobfOnSnap() {
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
      const evalRes = await client.send('Runtime.callFunctionOn', {
        objectId: fnProp.value.objectId,
        functionDeclaration: `function() {
          const dec = this;
          function _0x5624a3(a, b) { return dec(b + 0x470, a); }
          function _0x5e6cb6(a, b) { return dec(b + 0x628, a); }

          const C = System.get("chunks:///_virtual/City.ts").City;
          let src = C.prototype.onSnap.toString();

          function _0x1bb6c0(_0x40b0ac, _0x4cb89d) { return _0x5e6cb6(_0x4cb89d, _0x40b0ac - 0x265); }
          function _0x549365(_0x17b180, _0x36e74e) { return _0x5e6cb6(_0x36e74e, _0x17b180 - 0x4dd); }

          src = src.replace(/_0x1bb6c0\\(([-+0-9a-fx]+),\\s*([-+0-9a-fx]+)\\)/g, (m, a, b) => {
            return JSON.stringify(_0x1bb6c0(eval(a), eval(b)));
          });
          src = src.replace(/_0x549365\\(([-+0-9a-fx]+),\\s*([-+0-9a-fx]+)\\)/g, (m, a, b) => {
            return JSON.stringify(_0x549365(eval(a), eval(b)));
          });

          return src;
        }`,
        returnByValue: true
      });

      console.log('Fully deobfuscated onSnap:\n', evalRes.result.value);
      break;
    }
  }
  await browser.close();
}
fullDeobfOnSnap().catch(console.error);
