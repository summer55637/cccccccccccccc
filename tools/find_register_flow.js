const fs = require('fs');

const code = fs.readFileSync('C:/Users/user/Desktop/小樹/client/assets/main/index.3e757.js', 'utf8');

// Find string function definition in index.3e757.js
// It usually starts with function _0x3f73 or similar
const match = code.match(/function (_0x[a-f0-9]+)\(_0x[a-f0-9]+,\s*_0x[a-f0-9]+\)\s*\{\s*_0x[a-f0-9]+=\s*_0x[a-f0-9]+-/);
console.log('Main string decoder match:', match ? match[1] : 'none');

// Let's search for "login" or EditBox or UI events in main scene or bundle!
