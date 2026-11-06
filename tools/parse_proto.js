const fs = require('fs');

const code = fs.readFileSync('C:/Users/user/Desktop/小樹/client/src/assets/scripts/net/goline-adapter.deobf.js', 'utf8');
const p = code.indexOf('raw(');
console.log(code.slice(p, p + 400));
