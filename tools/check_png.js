const fs = require('fs');

const buf = fs.readFileSync('C:/Users/user/Desktop/小樹/tools/screenshot.png');
console.log('Screenshot file size:', buf.length);
// If a 720x1280 PNG is pure solid black (#000000), it compresses to ~5-15 KB.
// If it contains textures, colors, UI, background images, it is usually > 50-300 KB!
console.log('PNG size in KB:', (buf.length / 1024).toFixed(1), 'KB');
