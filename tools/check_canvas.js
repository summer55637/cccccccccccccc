const puppeteer = require('puppeteer-core');

async function run() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 720, height: 1280 });
  await page.goto('http://localhost:3008/', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 3000));

  // Sample pixel data from the GameCanvas
  const pixelInfo = await page.evaluate(() => {
    const canvas = document.getElementById('GameCanvas');
    if (!canvas) return 'No GameCanvas';
    const ctx = canvas.getContext('2d') || canvas.getContext('webgl2') || canvas.getContext('webgl');
    return {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      contextType: ctx ? ctx.constructor.name : 'null',
      activeElement: document.activeElement ? document.activeElement.tagName : 'none'
    };
  });

  console.log('Pixel info & Canvas state:', pixelInfo);
  await browser.close();
}

run().catch(console.error);
