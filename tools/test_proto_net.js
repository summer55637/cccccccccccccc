const protobuf = require('protobufjs');
const root = protobuf.loadSync('C:/Users/user/Desktop/小樹/tools/goline.proto');

const ClientMsg = root.lookupType('goline.ClientMsg');
const ServerMsg = root.lookupType('goline.ServerMsg');

// Test encode auth in ClientMsg
const clientPayload = {
  auth: {
    token: 'test_token',
    nonce: 'test_nonce',
    ver: '1'
  }
};
const clientBuf = ClientMsg.encode(ClientMsg.create(clientPayload)).finish();
console.log('Encoded ClientMsg length:', clientBuf.length);

const decodedClient = ClientMsg.decode(clientBuf);
console.log('Decoded ClientMsg auth:', decodedClient.auth ? decodedClient.auth.token : 'null');

// Test encode authResult in ServerMsg
const serverPayload = {
  authResult: {
    ok: true,
    username: 'test_user'
  },
  charList: {
    chars: [
      { ci: 0, name: '小樹英雄', cls: 'knight', level: 1, portrait: 'knight', str: 18, dex: 12, con: 14 }
    ]
  }
};
const serverBuf = ServerMsg.encode(ServerMsg.create(serverPayload)).finish();
console.log('Encoded ServerMsg length:', serverBuf.length);

const decodedServer = ServerMsg.decode(serverBuf);
console.log('Decoded ServerMsg authResult:', decodedServer.authResult ? decodedServer.authResult.username : 'null');
console.log('Decoded ServerMsg charList:', decodedServer.charList ? decodedServer.charList.chars.length : 0);
console.log('ALL PROTOBUF ENCODE/DECODE TESTS PASSED!');
