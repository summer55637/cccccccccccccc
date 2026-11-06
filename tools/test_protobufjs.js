const protobuf = require('protobufjs');

protobuf.load('C:/Users/user/Desktop/小樹/tools/goline.proto', (err, root) => {
  if (err) {
    console.error('Error loading goline.proto with protobufjs:', err.message);
    return;
  }
  console.log('protobufjs loaded goline.proto perfectly!');
  const ServerMsg = root.lookupType('goline.ServerMsg');
  const ClientMsg = root.lookupType('goline.ClientMsg');
  console.log('ServerMsg fields:', Object.keys(ServerMsg.fields).length);
  console.log('ClientMsg fields:', Object.keys(ClientMsg.fields).length);
});
