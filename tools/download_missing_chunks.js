const https = require('https');
const fs = require('fs');
const path = require('path');

const list = [
  'assets/internal/index.9e58a.js',
  'assets/resources/index.caeb6.js',
  'cocos-js/spine.wasm-BP65faBu.js',
  'cocos-js/spine-BGFFnNyc.js',
  'cocos-js/spine.asm-BCCB8IGt.js',
  'cocos-js/spine.js-CPHn08RU.js'
];

function download(relPath) {
  return new Promise((resolve) => {
    const url = 'https://test.xiaoshu.gg/play/' + relPath;
    const dest = path.join('C:/Users/user/Desktop/小樹/client', relPath);
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      console.log(res.statusCode, relPath);
      if (res.statusCode === 200) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const stream = fs.createWriteStream(dest);
        res.pipe(stream);
        stream.on('finish', () => resolve(true));
      } else {
        resolve(false);
      }
    }).on('error', () => resolve(false));
  });
}

async function main() {
  for (let f of list) {
    await download(f);
  }
}
main();
