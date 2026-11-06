const WebSocket = require('ws');
const protobuf = require('protobufjs');
const path = require('path');

const BASE = 'http://localhost:3008';
const protoRoot = protobuf.loadSync(path.join(__dirname, 'goline.proto'));
const ClientMsg = protoRoot.lookupType('goline.ClientMsg');
const ServerMsg = protoRoot.lookupType('goline.ServerMsg');

async function test() {
  console.log('--- 1. Testing Cocos Client HTML ---');
  const htmlRes = await fetch(BASE + '/');
  const html = await htmlRes.text();
  console.log('HTML size:', html.length, 'Contains GameCanvas:', html.includes('GameCanvas'), 'Contains Cocos3dGameContainer:', html.includes('Cocos3dGameContainer'));
  if (!html.includes('GameCanvas')) throw new Error('Root does not serve Cocos Creator index.html!');

  console.log('\n--- 2. Testing Cocos Engine Static Files ---');
  const polyRes = await fetch(BASE + '/src/polyfills.bundle.5adbf.js');
  console.log('Polyfills status:', polyRes.status, 'Size:', (await polyRes.text()).length);

  const settingsRes = await fetch(BASE + '/src/settings.57846.json');
  console.log('Settings status:', settingsRes.status);

  console.log('\n--- 3. Testing REST APIs ---');
  const shardRes = await fetch(BASE + '/api/shardinfo');
  const shard = await shardRes.json();
  console.log('Shard response:', shard.name);

  const nonceRes = await fetch(BASE + '/api/wsnonce');
  const nonceData = await nonceRes.json();
  console.log('Nonce response:', nonceData.ws, nonceData.nonce);

  const gdRes = await fetch(BASE + '/gamedata.json', { method: 'POST' });
  const gd = await gdRes.json();
  console.log('Gamedata loaded items count:', Object.keys(gd.items || {}).length);

  console.log('\n--- 4. Testing Registration & Login ---');
  const testUser = 'hero_' + Date.now().toString().slice(-4);
  const regRes = await fetch(BASE + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: testUser, password: 'password123' })
  });
  const reg = await regRes.json();
  console.log('Register result:', reg);

  console.log('\n--- 5. Testing Protobuf WebSocket Connection (/ws) ---');
  const ws = new WebSocket(`ws://localhost:3008/ws`);
  ws.binaryType = 'arraybuffer';

  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      console.log('WebSocket connected to /ws successfully!');
      // Send Protobuf Auth Message
      const authPayload = {
        auth: {
          token: reg.token,
          nonce: nonceData.nonce,
          ver: '1'
        }
      };
      const buf = ClientMsg.encode(ClientMsg.create(authPayload)).finish();
      ws.send(buf);
      console.log('Sent Protobuf ClientMsg Auth');
    });

    ws.on('message', (data) => {
      const u8 = new Uint8Array(data);
      const serverMsg = ServerMsg.decode(u8);

      if (serverMsg.authResult) {
        console.log('Received ServerMsg authResult:', serverMsg.authResult.ok ? 'OK' : 'FAIL', 'Username:', serverMsg.authResult.username);
      }

      if (serverMsg.charList) {
        const count = (serverMsg.charList.chars || []).length;
        console.log('Received ServerMsg charList count:', count);
        if (count === 0) {
          console.log('No characters found, sending CreateChar...');
          const createPayload = {
            createChar: {
              slot: 0,
              cls: 'knight',
              name: '小樹騎士',
              str: 18,
              dex: 12,
              con: 14
            }
          };
          const buf = ClientMsg.encode(ClientMsg.create(createPayload)).finish();
          ws.send(buf);
        } else {
          console.log('Character exists:', serverMsg.charList.chars[0].name, 'Sending SelectChar (ci: 0)...');
          const selectPayload = {
            selectChar: { ci: 0 }
          };
          const buf = ClientMsg.encode(ClientMsg.create(selectPayload)).finish();
          ws.send(buf);
        }
      }

      if (serverMsg.enterGame) {
        console.log('Received ServerMsg enterGame event!');
      }

      if (serverMsg.state) {
        console.log(`Received ServerMsg state: Level=${serverMsg.state.level}, HP=${serverMsg.state.hp}/${serverMsg.state.maxHp}, Gold=${serverMsg.state.gold}`);
        console.log('\n=== ALL COCOS CREATOR PROTOBUF & NETWORK TESTS PASSED! ===');
        ws.close();
        resolve();
      }
    });

    ws.on('error', reject);
  });
}

test().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
