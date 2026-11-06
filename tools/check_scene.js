const fs = require('fs');

// We have puppeteer-core! We can inspect the canvas by evaluating inside the browser!
// Let's take a screenshot and read console or get text from canvas or find what scene is active!
const puppeteer = require('puppeteer-core');

async function check() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 720, height: 1280 });

  await page.goto('http://localhost:3008/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));

  const state = await page.evaluate(() => {
    // Check Cocos cc object!
    if (typeof cc === 'undefined') return 'cc is undefined';
    const scene = cc.director ? cc.director.getScene() : null;
    if (!scene) return 'no scene';

    function dumpNode(n, depth = 0) {
      if (!n || depth > 4) return null;
      return {
        name: n.name,
        active: n.active,
        children: (n.children || []).filter(c => c.active).map(c => dumpNode(c, depth + 1))
      };
    }

    return {
      sceneName: scene.name,
      tree: dumpNode(scene)
    };
  });

  console.log('Cocos Scene State:', JSON.stringify(state, null, 2));
  await browser.close();
}

check().catch(console.error);
