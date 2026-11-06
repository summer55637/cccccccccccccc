const protobuf = require('protobufjs');

const root = protobuf.loadSync('C:/Users/user/Desktop/小樹/tools/goline.proto');
const ServerMsg = root.lookupType('goline.ServerMsg');

const buf = ServerMsg.encode({
  authResult: { ok: true, username: 'testHero' }
}).finish();

console.log('Wire bytes for authResult length:', buf.length);
console.log('Wire bytes:', [...buf]);
const decoded = ServerMsg.decode(buf);
console.log('Decoded authResult:', decoded.authResult);
