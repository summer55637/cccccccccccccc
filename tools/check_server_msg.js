const fs = require('fs');

const proto = fs.readFileSync('C:/Users/user/Desktop/小樹/tools/goline.proto', 'utf8');
const p = proto.indexOf('message ServerMsg');
console.log(proto.slice(p, p + 1000));
