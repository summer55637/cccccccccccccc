const puppeteer = require('puppeteer-core');

async function deobfPlaceNpcs() {
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
    const fnProp = scopeObj.result.find(x => x.name === '_0x534029');
    if (fnProp) {
      const evalRes = await client.send('Runtime.callFunctionOn', {
        objectId: fnProp.value.objectId,
        functionDeclaration: `function() {
          const dec = this;
          function _0x5624a3(a, b) { return dec(b + 0x470, a); }
          function _0x5e6cb6(a, b) { return dec(b + 0x628, a); }

          const C = System.get("chunks:///_virtual/City.ts").City;
          let src = C.prototype.placeNpcs.toString();

          // Find any inner helpers
          const helpers = {};
          const regex = /function\\s+([a-zA-Z0-9_$]+)\\(([^)]+)\\)\\s*\\{\\s*return\\s+([a-zA-Z0-9_$]+)\\(([^;]+)\\);\\s*\\}/g;
          let m;
          while ((m = regex.exec(src)) !== null) {
            const name = m[1];
            const params = m[2].split(',').map(s => s.trim());
            const target = m[3];
            const expr = m[4];
            helpers[name] = new Function(params[0], params[1], 'return ' + (target === '_0x5e6cb6' ? '_0x5e6cb6(' : 'dec(') + expr + ');');
          }

          for (const [hName, hFn] of Object.entries(helpers)) {
            const callRegex = new RegExp('\\\\b' + hName + '\\\\(([-+0-9a-fx]+),\\s*([-+0-9a-fx]+)\\\\)', 'g');
            src = src.replace(callRegex, (match, a, b) => {
              try {
                return JSON.stringify(hFn(eval(a), eval(b)));
              } catch(e) {
                return match;
              }
            });
          }
          return src;
        }`,
        returnByValue: true
      });
      console.log('placeNpcs deobfuscated:\n', evalRes.result.value);
      break;
    }
  }
  await browser.close();
}
deobfPlaceNpcs().catch(console.error);
