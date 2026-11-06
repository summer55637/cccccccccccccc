const fs = require('fs');

const code = fs.readFileSync('C:/Users/user/Desktop/小樹/client/cocos-js/spine.wasm-BP65faBu.js', 'utf8');
const p = code.indexOf('spine.wasm');
console.log(code.slice(Math.max(0, p - 200), p + 200));
