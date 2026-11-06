const fs = require('fs');

const code = fs.readFileSync('C:/Users/user/Desktop/小樹/client/assets/main/index.3e757.js', 'utf8');
console.log(code.slice(5150000, 5151500));
