const fs = require('fs');

const code = fs.readFileSync('C:/Users/user/Desktop/小樹/client/cocos-js/_virtual_cc-Bp5iGE8z.js', 'utf8');
const matches = code.match(/["'][^"']*\.(?:js|wasm|bin|json)["']/g) || [];
console.log('Matches in virtual cc:', [...new Set(matches)]);

const codeSettings = fs.readFileSync('C:/Users/user/Desktop/小樹/client/src/settings.57846.json', 'utf8');
const matchesSettings = codeSettings.match(/["'][^"']*\.(?:js|wasm|bin|json)["']/g) || [];
console.log('Matches in settings:', [...new Set(matchesSettings)]);
