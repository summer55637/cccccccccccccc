const protobuf = require('protobufjs');
const fs = require('fs');

try {
  const descriptor = fs.readFileSync('C:/Users/user/Desktop/小樹/tools/goline.proto.bin');
  const decoded = protobuf.descriptor.FileDescriptorSet.decode(descriptor);
  const root = protobuf.Root.fromDescriptor(decoded);
  console.log('Successfully decoded FileDescriptorSet and created root!');
  const ClientMsg = root.lookupType('goline.ClientMsg');
  const ServerMsg = root.lookupType('goline.ServerMsg');
  console.log('ClientMsg fields count:', Object.keys(ClientMsg.fields).length);
  console.log('ServerMsg fields count:', Object.keys(ServerMsg.fields).length);
} catch (err) {
  console.error('Error:', err);
}
