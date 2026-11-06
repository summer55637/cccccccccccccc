const fs = require('fs');

const code = fs.readFileSync('C:/Users/user/Desktop/小樹/client/cocos-js/_virtual_cc-Bp5iGE8z.js', 'utf8');
const p = code.indexOf('System.register(');
console.log('System.register in _virtual_cc-Bp5iGE8z.js:');
console.log(code.slice(p, p + 500));
