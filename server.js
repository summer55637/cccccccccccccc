const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const protobuf = require('protobufjs');

const PORT = process.env.PORT || 3008;

// 1. Load native Protobuf definitions
const protoRoot = protobuf.loadSync(path.join(__dirname, 'tools', 'goline.proto'));
const ClientMsg = protoRoot.lookupType('goline.ClientMsg');
const ServerMsg = protoRoot.lookupType('goline.ServerMsg');

// 2. Simple local storage for native accounts & characters
const DB_FILE = path.join(__dirname, 'local_accounts.json');
let localDb = { accounts: {}, tokens: {} };
if (fs.existsSync(DB_FILE)) {
  try {
    localDb = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    localDb = { accounts: {}, tokens: {} };
  }
}
function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(localDb, null, 2), 'utf8');
  } catch (e) {}
}

const app = express();
const server = http.createServer(app);

app.use(cors());
// Parse raw text, JSON, and form data
app.use(express.text({ type: '*/*' }));
app.use((req, res, next) => {
  if (typeof req.body === 'string' && req.body.trim().startsWith('{')) {
    try {
      req.body = JSON.parse(req.body);
    } catch (e) {}
  }
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.urlencoded({ extended: true }));

// Disable caching for HTML and critical assets during development
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html') || req.path.endsWith('.js')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Favicon
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ==========================================
// Static File Hosting (Pure XiaoShu Client)
// ==========================================

// Packs manifest & packs directory with on-demand remote caching
const PACKS_DIR = path.join(__dirname, 'client', 'assets-packs');
if (!fs.existsSync(PACKS_DIR)) fs.mkdirSync(PACKS_DIR, { recursive: true });

app.get('/assets-packs/:filename', (req, res) => {
  const file = req.params.filename;
  const localPath = path.join(PACKS_DIR, file);
  if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
    return res.sendFile(localPath);
  }

  // Auto-fetch from remote and cache locally
  const remoteUrl = `https://test.xiaoshu.gg/assets-packs/${file}`;
  https.get(remoteUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, remoteRes => {
    if (remoteRes.statusCode === 200) {
      const fileStream = fs.createWriteStream(localPath);
      remoteRes.pipe(fileStream);
      remoteRes.pipe(res);
    } else {
      res.status(remoteRes.statusCode).end();
    }
  }).on('error', () => res.status(404).end());
});

// Serve root directly from client/
app.use('/', express.static(path.join(__dirname, 'client')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'index.html'));
});

// Serve portal landing page
app.use('/portal', express.static(path.join(__dirname, 'portal')));
app.get('/portal', (req, res) => {
  res.sendFile(path.join(__dirname, 'portal', 'index.html'));
});

// Helper to serve extracted JSON files safely
function serveJson(res, fileName) {
  const p = path.join(__dirname, 'extracted_data', fileName);
  if (fs.existsSync(p)) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.sendFile(p);
  } else {
    res.json({});
  }
}

// ==========================================
// XiaoShu Native REST API Endpoints
// ==========================================

app.get('/healthz', (req, res) => {
  res.json({ ok: true, engine: 'Cocos Creator 3.8.8', app: 'xiaoshu' });
});

// Shard Information
app.get('/api/shardinfo', (req, res) => {
  res.json({
    id: 'S1',
    name: '小樹測試服',
    count: wss.clients ? wss.clients.size : 1,
    full: false,
    gdv: '1',
    bdfee: 0,
    feat: {
      tianfa: true,
      twilight: true,
      doll: true,
      codex: true,
      castle: true,
      pk: true
    },
    push: {},
    pay: 'ALL',
    emailverify: false,
    turnstile: ''
  });
});

// WebSocket Nonce & URL
app.get('/api/wsnonce', (req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  res.json({
    v: '1',
    ws: `ws://${host}/ws`,
    nonce: `xs_nonce_${Date.now()}`
  });
});

// Game Database (Items, Mobs, Maps, Skills)
app.get('/gamedata.json', (req, res) => serveJson(res, 'gamedata.json'));
app.post('/gamedata.json', (req, res) => serveJson(res, 'gamedata.json'));

// Server Time
app.get('/api/time', (req, res) => {
  res.json({ now: Date.now() });
});

// Castles, NPCs, Rankings
app.get('/api/castles', (req, res) => serveJson(res, 'castles.json'));
app.get('/api/npcs', (req, res) => serveJson(res, 'npcs.json'));
app.get('/api/npchtml', (req, res) => serveJson(res, 'npchtml.json'));
app.get('/api/rank3', (req, res) => serveJson(res, 'rank3.json'));
app.get('/api/ranking', (req, res) => serveJson(res, 'ranking.json'));
app.get('/version.json', (req, res) => res.json({ version: 'v0.164', app: 'v0.164', ok: true }));
app.get('/api/google-config', (req, res) => res.json({ clientId: '', ok: true }));

// Registration & Login
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username) return res.json({ ok: false, msg: '請輸入帳號', err: '請輸入帳號' });
  if (!password) return res.json({ ok: false, msg: '請輸入密碼', err: '請輸入密碼' });

  if (localDb.accounts[username]) {
    return res.json({ ok: false, msg: '此帳號已存在', err: '此帳號已存在' });
  }

  const token = 'tk_' + username + '_' + Date.now().toString(36);
  localDb.accounts[username] = {
    username,
    password: password || '123456',
    chars: [],
    createdAt: Date.now()
  };
  localDb.tokens[token] = username;
  saveDb();

  console.log(`[Auth] Registered new account: ${username}`);
  res.json({ ok: true, token, user: { username } });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username) return res.json({ ok: false, msg: '請輸入帳號', err: '請輸入帳號' });

  let account = localDb.accounts[username];
  if (!account) {
    // If not found, auto-register for seamless local user experience!
    const token = 'tk_' + username + '_' + Date.now().toString(36);
    account = {
      username,
      password: password || '123456',
      chars: [],
      createdAt: Date.now()
    };
    localDb.accounts[username] = account;
    localDb.tokens[token] = username;
    saveDb();
    console.log(`[Auth] Auto-registered local account on login: ${username}`);
    return res.json({ ok: true, token, user: { username } });
  }

  if (password && account.password && account.password !== password) {
    return res.json({ ok: false, msg: '密碼不正確', err: '密碼不正確' });
  }

  const token = 'tk_' + username + '_' + Date.now().toString(36);
  localDb.tokens[token] = username;
  saveDb();

  console.log(`[Auth] Logged in account: ${username}`);
  res.json({ ok: true, token, user: { username } });
});

// Stubs for client reports, preferences, and notice
const MASTER_PACK_KEY = Buffer.from('28fc4ca4c87011b855a48af177d74b72433bc85906f4f03468de75412848462d', 'hex');

function wrapPackKey(token) {
  const hash = crypto.createHash('sha256').update('goline-packkey-v1|' + token).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', hash, iv);
  const enc = Buffer.concat([cipher.update(MASTER_PACK_KEY), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString('base64');
}

app.post('/api/packkey', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.json({ ok: false, msg: 'bad token' });
  const wrap = wrapPackKey(token);
  console.log(`[PackKey] Generated packkey wrap for token ${token}`);
  res.json({ ok: true, v: 2, wrap });
});

app.all('/api/clientreport', (req, res) => res.json({ ok: true }));
app.all('/api/prefs/set', (req, res) => res.json({ ok: true }));
app.all('/api/prefs', (req, res) => res.json({}));
app.all('/api/notice', (req, res) => res.json({ list: [] }));
app.all('/api/dropped', (req, res) => res.json({ list: [] }));
app.all('/api/ping', (req, res) => res.json({ ok: true }));

// ==========================================
// Native Protobuf WebSocket (/ws)
// ==========================================
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  console.log(`[WebSocket] New Cocos Client connected from ${req.socket.remoteAddress}`);
  let currentUser = null;
  let selectedChar = null;
  let heartbeatTimer = null;

  function sendServerMsg(payload) {
    if (ws.readyState !== ws.OPEN) return;
    try {
      const errMsg = ServerMsg.verify(payload);
      if (errMsg) console.warn('[ServerMsg Verify Warn]', errMsg);
      const buf = ServerMsg.encode(ServerMsg.create(payload)).finish();
      ws.send(buf, { binary: true });
    } catch (err) {
      console.error('[ServerMsg Encode Error]', err);
    }
  }

  ws.on('message', (data) => {
    let msg;
    try {
      const u8 = new Uint8Array(data);
      msg = ClientMsg.decode(u8);
    } catch (err) {
      console.error('[WebSocket] Failed to decode ClientMsg:', err);
      return;
    }

    // 1. Authentication
    if (msg.auth) {
      const token = msg.auth.token;
      const username = localDb.tokens[token] || (token && token.replace(/^tk_/, '').split('_')[0]) || '英雄玩家';
      
      let account = localDb.accounts[username];
      if (!account) {
        account = { username, chars: [], createdAt: Date.now() };
        localDb.accounts[username] = account;
        localDb.tokens[token] = username;
        saveDb();
      }
      currentUser = account;
      console.log(`[WebSocket] Client authenticated as: ${username}`);

      // Send authResult
      sendServerMsg({
        authResult: {
          ok: true,
          username: username
        }
      });

      // Send character list
      sendServerMsg({
        charList: {
          chars: account.chars.map((c, idx) => ({
            ci: idx,
            name: c.name,
            cls: c.cls,
            level: c.level || 1,
            portrait: c.portrait || c.cls,
            str: c.str || 18,
            dex: c.dex || 12,
            con: c.con || 14,
            int: c.int || 10,
            wis: c.wis || 10,
            cha: c.cha || 10
          }))
        }
      });
      return;
    }

    // 2. Character Creation
    if (msg.createChar) {
      if (!currentUser) return;
      const { slot, cls, name, str, dex, con, int_, wis, cha } = msg.createChar;
      const newChar = {
        ci: slot || currentUser.chars.length,
        name: name || '小樹守護者',
        cls: cls || 'knight',
        level: 1,
        portrait: cls || 'knight',
        str: str || 18,
        dex: dex || 12,
        con: con || 14,
        int: int_ || 10,
        wis: wis || 10,
        cha: cha || 10,
        hp: 100,
        maxHp: 100,
        mp: 50,
        maxMp: 50,
        gold: 10000,
        exp: 0,
        expNeed: 100
      };
      currentUser.chars[slot || 0] = newChar;
      saveDb();
      console.log(`[WebSocket] Created character: ${newChar.name} (${newChar.cls})`);

      // Update charList
      sendServerMsg({
        charList: {
          chars: currentUser.chars.map((c, idx) => ({
            ci: idx,
            name: c.name,
            cls: c.cls,
            level: c.level || 1,
            portrait: c.portrait || c.cls,
            str: c.str,
            dex: c.dex,
            con: c.con,
            int: c.int,
            wis: c.wis,
            cha: c.cha
          }))
        }
      });
      return;
    }

    // 3. Character Selection & Enter Game
    if (msg.selectChar) {
      if (!currentUser) return;
      const ci = msg.selectChar.ci || 0;
      selectedChar = currentUser.chars[ci] || currentUser.chars[0];
      if (!selectedChar) {
        selectedChar = {
          ci: 0,
          name: '小樹冒險者',
          cls: 'knight',
          level: 1,
          portrait: 'knight',
          str: 18, dex: 12, con: 14, int: 10, wis: 10, cha: 10,
          hp: 100, maxHp: 100, mp: 50, maxMp: 50, gold: 10000, exp: 0, expNeed: 100
        };
        currentUser.chars[0] = selectedChar;
        saveDb();
      }

      console.log(`[WebSocket] Entering game with character: ${selectedChar.name}`);
      sendServerMsg({ enterGame: {} });

      // Send initial state frame
      sendServerMsg({
        state: {
          hp: selectedChar.hp || 100,
          maxHp: selectedChar.maxHp || 100,
          mp: selectedChar.mp || 50,
          maxMp: selectedChar.maxMp || 50,
          level: selectedChar.level || 1,
          exp: selectedChar.exp || 0,
          expNeed: selectedChar.expNeed || 100,
          gold: selectedChar.gold || 10000,
          ts: Date.now(),
          full: false,
          inv: [],
          eq: [],
          skills: []
        }
      });

      // Send initial World snapshot to transition into game scene
      console.log(`[WebSocket] Sending WorldSnap for ${selectedChar.name} at town_silver_knight`);
      sendServerMsg({
        worldSnap: {
          map: 'town_silver_knight',
          x: 333,
          y: 163,
          me: 1,
          line: 1,
          lines: 1,
          speed: 1,
          visN: 10
        }
      });

      // Keep connection heartbeat / state sync alive
      if (!heartbeatTimer) {
        heartbeatTimer = setInterval(() => {
          if (ws.readyState === ws.OPEN && selectedChar) {
            sendServerMsg({
              state: {
                hp: selectedChar.hp,
                maxHp: selectedChar.maxHp,
                mp: selectedChar.mp,
                maxMp: selectedChar.maxMp,
                level: selectedChar.level,
                exp: selectedChar.exp,
                expNeed: selectedChar.expNeed,
                gold: selectedChar.gold,
                ts: Date.now()
              }
            });
          }
        }, 3000);
      }
      return;
    }

    // 4. World Enter Request
    if (msg.worldEnter) {
      const mapName = msg.worldEnter.map || 'town_silver_knight';
      console.log(`[WebSocket] World enter requested: ${mapName}`);
      sendServerMsg({
        worldSnap: {
          map: mapName,
          x: 333,
          y: 163,
          me: 1,
          line: 1,
          lines: 1,
          speed: 1,
          visN: 10
        }
      });
      return;
    }

    // 5. World Step (Player movement)
    if (msg.worldStep) {
      if (selectedChar) {
        selectedChar.gx = msg.worldStep.gx;
        selectedChar.gy = msg.worldStep.gy;
      }
      return;
    }

    // 6. Chat message
    if (msg.chat) {
      const sender = selectedChar ? selectedChar.name : (currentUser ? currentUser.username : '系統');
      console.log(`[Chat] ${sender}: ${msg.chat.text}`);
      sendServerMsg({
        chat: {
          user: sender,
          text: msg.chat.text || '',
          chan: msg.chat.chan || 'normal',
          time: new Date().toLocaleTimeString('zh-TW', { hour12: false })
        }
      });
      return;
    }
  });

  ws.on('close', () => {
    console.log('[WebSocket] Cocos Client disconnected');
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  });

  ws.on('error', (err) => {
    console.error('[WebSocket] Error:', err);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  });
});

// ==========================================
// Start Server
// ==========================================
server.listen(PORT, () => {
  console.log('====================================================');
  console.log('★ 小樹原生 Cocos Creator 3.8.8 伺服器已啟動！');
  console.log(`★ 遊戲進入點: http://localhost:${PORT}/`);
  console.log(`★ 官網展示頁: http://localhost:${PORT}/portal`);
  console.log(`★ WebSocket 協議: Protobuf (goline.proto) on /ws`);
  console.log(`★ 監聽 PORT: ${PORT}`);
  console.log('====================================================');
});
