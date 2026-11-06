const fs = require('fs');

const code = fs.readFileSync('C:/Users/user/Desktop/小樹/client/src/assets/scripts/net/goline-adapter.deobf.js', 'utf8');
const p = code.indexOf('Cgxnb2xpbmUucHJvdG8');
if (p !== -1) {
  const p2 = code.indexOf('"', p);
  const base64 = code.slice(p, p2);
  console.log('Proto Base64 length:', base64.length);
  fs.writeFileSync('C:/Users/user/Desktop/小樹/tools/goline.proto.bin', Buffer.from(base64, 'base64'));
  console.log('Saved goline.proto.bin');
} else {
  console.log('Base64 proto not found');
}
