const puppeteer = require('puppeteer-core');

async function deobfOnSnap() {
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
          function _0x1bb6c0(_0x40b0ac, _0x4cb89d) { return _0x5e6cb6(_0x4cb89d, _0x40b0ac - 0x265); }
          function _0x549365(_0x17b180, _0x36e74e) { return _0x5e6cb6(_0x36e74e, _0x17b180 - 0x4dd); }

          return {
            s1: _0x549365(0x31f1, 0x2b8e),
            s2: _0x549365(0x1cd3, 0x28ad),
            s3: _0x549365(0x2902, 0x3a83),
            s4: _0x1bb6c0(0xed3, 0x26fd),
            s5: _0x1bb6c0(0x2b15, 0x1e58),
            s6: _0x549365(0x2f3d, 0x1ee8),
            s7: _0x1bb6c0(0xeb8, 0x860),
            s8: _0x1bb6c0(0x1d73, 0x2438),
            s9: _0x1bb6c0(0x27bb, 0x39e5),
            s10: _0x1bb6c0(0x2937, 0x1416),
            s11: _0x1bb6c0(0x1f18, 0x3433),
          };
        }`,
        returnByValue: true
      });

      console.log('onSnap strings:', JSON.stringify(evalRes.result.value, null, 2));
      break;
    }
  }
  await browser.close();
}
deobfOnSnap().catch(console.error);
