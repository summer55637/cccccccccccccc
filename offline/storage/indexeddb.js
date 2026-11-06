const DB_NAME = "offline-adventure-save";
const DB_VERSION = 1;
const STORES = Object.freeze({
  characters: "characters",
  inventories: "inventories",
  equipment: "equipment",
  skills: "skills",
  quests: "quests",
  settings: "settings",
});
const CHARACTER_FIELDS = new Set([
  "name", "classId", "level", "jobLevel", "experience", "stats",
  "hp", "mp", "mapId", "position", "gold", "playTimeSeconds",
]);
const SAVE_PARTS = new Set(["inventory", "equipment", "skills", "quests"]);
const STAT_NAMES = ["str", "dex", "int", "agi", "vit", "luk"];

function isObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function textValue(value, label, max = 128) {
  if (typeof value !== "string") throw new TypeError(`${label}必須是文字。`);
  const result = value.trim();
  if (!result || [...result].length > max || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new Error(`${label}不可空白、過長或含控制字元。`);
  }
  return result;
}
function integer(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${label}必須是 ${min} 到 ${max} 之間的整數。`);
  }
  return value;
}
function createId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("無法產生安全角色 ID。請以 localhost 或 HTTPS 開啟。");
}
function normalizeStats(input, base = null) {
  if (input !== undefined && !isObject(input)) throw new TypeError("stats 必須是物件。");
  const result = {};
  for (const key of STAT_NAMES) {
    const value = input && Object.hasOwn(input, key) ? input[key] : (base ? base[key] : 1);
    result[key] = integer(value, `能力值 ${key}`, 1, 9999);
  }
  if (input) for (const key of Object.keys(input)) {
    if (!STAT_NAMES.includes(key)) throw new Error(`不支援的能力值欄位：${key}`);
  }
  return result;
}
function normalizeGauge(input, base, label, defaultMax) {
  if (input !== undefined && !isObject(input)) throw new TypeError(`${label} 必須是物件。`);
  const max = integer(input?.max ?? base?.max ?? defaultMax, `${label}.max`, 1, 2_000_000_000);
  const current = integer(input?.current ?? base?.current ?? max, `${label}.current`, 0, max);
  if (input) for (const key of Object.keys(input)) {
    if (key !== "current" && key !== "max") throw new Error(`${label} 不支援欄位：${key}`);
  }
  return { current, max };
}
function normalizePosition(input, base = null) {
  if (input !== undefined && !isObject(input)) throw new TypeError("position 必須是物件。");
  const x = input?.x ?? base?.x ?? 0;
  const y = input?.y ?? base?.y ?? 0;
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 10_000_000 || Math.abs(y) > 10_000_000) {
    throw new RangeError("角色座標格式錯誤或超出範圍。");
  }
  if (input) for (const key of Object.keys(input)) {
    if (key !== "x" && key !== "y") throw new Error(`position 不支援欄位：${key}`);
  }
  return { x, y };
}
function makeCharacter(input) {
  if (!isObject(input)) throw new TypeError("建立角色時必須提供物件。");
  for (const key of Object.keys(input)) {
    if (key !== "name" && key !== "classId") throw new Error(`建立角色不接受欄位：${key}`);
  }
  const name = textValue(input.name, "角色名稱", 16);
  const classId = textValue(input.classId ?? "novice", "職業代碼", 32);
  if (!/^[a-zA-Z0-9_-]+$/.test(classId)) throw new Error("職業代碼格式錯誤。");
  const now = new Date().toISOString();
  return {
    schemaVersion: 1, characterId: createId(), name, nameKey: name.toLocaleLowerCase(),
    classId, level: 1, jobLevel: 1, experience: 0,
    stats: { str: 1, dex: 1, int: 1, agi: 1, vit: 1, luk: 1 },
    hp: { current: 100, max: 100 }, mp: { current: 50, max: 50 },
    mapId: "start", position: { x: 0, y: 0 }, gold: 0, playTimeSeconds: 0,
    createdAt: now, updatedAt: now,
  };
}
function patchCharacter(current, patch) {
  if (!isObject(patch)) throw new TypeError("角色更新資料必須是物件。");
  for (const key of Object.keys(patch)) {
    if (!CHARACTER_FIELDS.has(key)) throw new Error(`不允許更新角色欄位：${key}`);
  }
  const next = { ...current };
  if (Object.hasOwn(patch, "name")) {
    next.name = textValue(patch.name, "角色名稱", 16);
    next.nameKey = next.name.toLocaleLowerCase();
  }
  if (Object.hasOwn(patch, "classId")) {
    next.classId = textValue(patch.classId, "職業代碼", 32);
    if (!/^[a-zA-Z0-9_-]+$/.test(next.classId)) throw new Error("職業代碼格式錯誤。");
  }
  for (const key of ["level", "jobLevel"]) {
    if (Object.hasOwn(patch, key)) next[key] = integer(patch[key], key, 1, 100_000);
  }
  for (const key of ["experience", "gold", "playTimeSeconds"]) {
    if (Object.hasOwn(patch, key)) next[key] = integer(patch[key], key);
  }
  if (Object.hasOwn(patch, "stats")) next.stats = normalizeStats(patch.stats, current.stats);
  if (Object.hasOwn(patch, "hp")) next.hp = normalizeGauge(patch.hp, current.hp, "hp", 100);
  if (Object.hasOwn(patch, "mp")) next.mp = normalizeGauge(patch.mp, current.mp, "mp", 50);
  if (Object.hasOwn(patch, "mapId")) next.mapId = textValue(patch.mapId, "地圖代碼", 64);
  if (Object.hasOwn(patch, "position")) next.position = normalizePosition(patch.position, current.position);
  next.updatedAt = new Date().toISOString();
  return next;
}
function safeJsonObject(value, label) {
  if (!isObject(value)) throw new TypeError(`${label} 必須是一般物件。`);
  let raw;
  try { raw = JSON.stringify(value); } catch { throw new TypeError(`${label} 不是有效 JSON。`); }
  if (!raw || raw.length > 1_000_000) throw new RangeError(`${label} 太大，無法儲存。`);
  const copy = JSON.parse(raw);
  const inspect = (node, depth = 0) => {
    if (depth > 32) throw new RangeError(`${label} 巢狀層級過深。`);
    if (Array.isArray(node)) return node.forEach(item => inspect(item, depth + 1));
    if (node && typeof node === "object") for (const [key, item] of Object.entries(node)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error(`${label} 含有不允許的欄位。`);
      inspect(item, depth + 1);
    }
  };
  inspect(copy);
  return copy;
}
function normalizePart(part, characterId, value) {
  const data = safeJsonObject(value, part);
  if (part === "inventory") {
    const capacity = integer(data.capacity ?? 100, "背包容量", 1, 5000);
    const items = data.items ?? [];
    if (!Array.isArray(items) || items.length > 5000) throw new TypeError("inventory.items 必須是合理大小的陣列。");
    items.forEach((item, index) => {
      if (!isObject(item)) throw new TypeError(`第 ${index + 1} 個道具必須是物件。`);
      textValue(item.itemId, "道具 itemId", 128);
      integer(item.count, "道具數量", 1, 2_000_000_000);
    });
    return { characterId, capacity, items };
  }
  if (part === "equipment") {
    if (data.slots !== undefined && !isObject(data.slots)) throw new TypeError("equipment.slots 必須是物件。");
    return { characterId, slots: data.slots ?? {} };
  }
  if (part === "skills") {
    if (data.learned !== undefined && !Array.isArray(data.learned)) throw new TypeError("skills.learned 必須是陣列。");
    return { characterId, learned: data.learned ?? [] };
  }
  if (part === "quests") {
    if (data.entries !== undefined && !Array.isArray(data.entries)) throw new TypeError("quests.entries 必須是陣列。");
    return { characterId, entries: data.entries ?? [] };
  }
  throw new Error(`未知的存檔分類：${part}`);
}
function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB 讀取失敗。"));
  });
}
function transactionComplete(tx) {
  const promise = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("IndexedDB 交易已中止。"));
    tx.onerror = () => {};
  });
  promise.catch(() => {});
  return promise;
}
function dbError(error) {
  if (error?.name === "ConstraintError") return new Error("角色名稱已存在，請換一個名稱。");
  if (error?.name === "QuotaExceededError") return new Error("瀏覽器儲存空間不足。");
  return error instanceof Error ? error : new Error("IndexedDB 操作失敗。");
}

/** IndexedDB-backed local character saves. No network/server dependency. */
export class OfflineCharacterDB {
  constructor({ dbName = DB_NAME, indexedDB = globalThis.indexedDB } = {}) {
    this.dbName = textValue(dbName, "資料庫名稱", 128);
    this.indexedDB = indexedDB;
    this.db = null;
    this.opening = null;
  }

  async open() {
    if (this.db) return this.db;
    if (this.opening) return this.opening;
    if (!this.indexedDB?.open) throw new Error("目前瀏覽器不支援 IndexedDB，請使用 localhost 或 HTTPS。");
    this.opening = new Promise((resolve, reject) => {
      const req = this.indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const chars = db.objectStoreNames.contains(STORES.characters)
          ? req.transaction.objectStore(STORES.characters)
          : db.createObjectStore(STORES.characters, { keyPath: "characterId" });
        if (!chars.indexNames.contains("nameKey")) chars.createIndex("nameKey", "nameKey", { unique: true });
        if (!chars.indexNames.contains("updatedAt")) chars.createIndex("updatedAt", "updatedAt");
        for (const name of [STORES.inventories, STORES.equipment, STORES.skills, STORES.quests]) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "characterId" });
        }
        if (!db.objectStoreNames.contains(STORES.settings)) db.createObjectStore(STORES.settings, { keyPath: "key" });
      };
      req.onerror = () => reject(dbError(req.error));
      req.onblocked = () => reject(new Error("資料庫升級被其他分頁阻擋，請先關閉其他遊戲分頁。"));
      req.onsuccess = () => {
        this.db = req.result;
        this.db.onversionchange = () => { this.close(); };
        resolve(this.db);
      };
    }).catch(error => { this.opening = null; throw error; });
    return this.opening;
  }

  close() {
    this.db?.close();
    this.db = null;
    this.opening = null;
  }

  async createCharacter(input) {
    const db = await this.open();
    const c = makeCharacter(input);
    const tx = db.transaction([STORES.characters, STORES.inventories, STORES.equipment, STORES.skills, STORES.quests], "readwrite");
    const done = transactionComplete(tx);
    tx.objectStore(STORES.characters).add(c);
    tx.objectStore(STORES.inventories).add({ characterId: c.characterId, capacity: 100, items: [] });
    tx.objectStore(STORES.equipment).add({ characterId: c.characterId, slots: {} });
    tx.objectStore(STORES.skills).add({ characterId: c.characterId, learned: [] });
    tx.objectStore(STORES.quests).add({ characterId: c.characterId, entries: [] });
    try { await done; return c; } catch (error) { throw dbError(error); }
  }

  async getCharacter(characterId) {
    const id = textValue(characterId, "角色 ID");
    const db = await this.open();
    const tx = db.transaction(STORES.characters, "readonly");
    const done = transactionComplete(tx);
    const result = await requestValue(tx.objectStore(STORES.characters).get(id));
    await done;
    return result ?? null;
  }

  async listCharacters() {
    const db = await this.open();
    const tx = db.transaction(STORES.characters, "readonly");
    const done = transactionComplete(tx);
    const list = await requestValue(tx.objectStore(STORES.characters).getAll());
    await done;
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async updateCharacter(characterId, patch) {
    const id = textValue(characterId, "角色 ID");
    const db = await this.open();
    const tx = db.transaction(STORES.characters, "readwrite");
    const done = transactionComplete(tx);
    const store = tx.objectStore(STORES.characters);
    let updated = null;
    let operationError = null;
    const req = store.get(id);
    req.onsuccess = () => {
      if (!req.result) { operationError = new Error("找不到要更新的角色。"); tx.abort(); return; }
      try { updated = patchCharacter(req.result, patch); store.put(updated); }
      catch (error) { operationError = error; tx.abort(); }
    };
    try { await done; return updated; }
    catch (error) { throw operationError || dbError(error); }
  }

  /** Supplied parts are written atomically; omitted parts remain unchanged. */
  async saveCharacterData(characterId, saveData) {
    const id = textValue(characterId, "角色 ID");
    if (!isObject(saveData)) throw new TypeError("存檔內容必須是物件。");
    const normalized = {};
    for (const [part, value] of Object.entries(saveData)) {
      if (!SAVE_PARTS.has(part)) throw new Error(`不支援的存檔分類：${part}`);
      normalized[part] = normalizePart(part, id, value);
    }
    const storeFor = { inventory: STORES.inventories, equipment: STORES.equipment, skills: STORES.skills, quests: STORES.quests };
    const db = await this.open();
    const names = [STORES.characters, ...Object.keys(normalized).map(part => storeFor[part])];
    const tx = db.transaction(names, "readwrite");
    const done = transactionComplete(tx);
    let operationError = null;
    const req = tx.objectStore(STORES.characters).get(id);
    req.onsuccess = () => {
      if (!req.result) { operationError = new Error("找不到要儲存的角色。"); tx.abort(); return; }
      try {
        for (const [part, record] of Object.entries(normalized)) tx.objectStore(storeFor[part]).put(record);
        const c = req.result;
        c.updatedAt = new Date().toISOString();
        tx.objectStore(STORES.characters).put(c);
      } catch (error) { operationError = error; tx.abort(); }
    };
    try { await done; } catch (error) { throw operationError || dbError(error); }
    return this.loadCharacterSave(id);
  }

  async loadCharacterSave(characterId) {
    const id = textValue(characterId, "角色 ID");
    const db = await this.open();
    const tx = db.transaction([STORES.characters, STORES.inventories, STORES.equipment, STORES.skills, STORES.quests], "readonly");
    const done = transactionComplete(tx);
    const values = await Promise.all([
      requestValue(tx.objectStore(STORES.characters).get(id)),
      requestValue(tx.objectStore(STORES.inventories).get(id)),
      requestValue(tx.objectStore(STORES.equipment).get(id)),
      requestValue(tx.objectStore(STORES.skills).get(id)),
      requestValue(tx.objectStore(STORES.quests).get(id)),
    ]);
    await done;
    const [character, inventory, equipment, skills, quests] = values;
    if (!character) return null;
    return {
      character,
      inventory: inventory ?? { characterId: id, capacity: 100, items: [] },
      equipment: equipment ?? { characterId: id, slots: {} },
      skills: skills ?? { characterId: id, learned: [] },
      quests: quests ?? { characterId: id, entries: [] },
    };
  }


  async getSetting(key, fallback = null) {
    const normalizedKey = textValue(key, "設定名稱", 128);
    const database = await this.open();
    const tx = database.transaction(STORES.settings, "readonly");
    const done = transactionComplete(tx);
    const record = await requestValue(tx.objectStore(STORES.settings).get(normalizedKey));
    await done;
    return record ? record.value : fallback;
  }

  async setSetting(key, value) {
    const normalizedKey = textValue(key, "設定名稱", 128);
    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch {
      throw new TypeError("設定值必須是可保存的 JSON 資料。");
    }
    if (serialized === undefined || serialized.length > 16_384) {
      throw new RangeError("設定值不可為空的未定義值，且不可超過 16 KB。");
    }
    const safeValue = JSON.parse(serialized);
    const database = await this.open();
    const tx = database.transaction(STORES.settings, "readwrite");
    const done = transactionComplete(tx);
    tx.objectStore(STORES.settings).put({
      key: normalizedKey,
      value: safeValue,
      updatedAt: new Date().toISOString(),
    });
    await done;
    return safeValue;
  }

  async deleteCharacter(characterId) {
    const id = textValue(characterId, "角色 ID");
    const db = await this.open();
    const tx = db.transaction([STORES.characters, STORES.inventories, STORES.equipment, STORES.skills, STORES.quests], "readwrite");
    const done = transactionComplete(tx);
    let existed = false;
    const req = tx.objectStore(STORES.characters).get(id);
    req.onsuccess = () => {
      existed = Boolean(req.result);
      if (!existed) return;
      for (const name of [STORES.characters, STORES.inventories, STORES.equipment, STORES.skills, STORES.quests]) {
        tx.objectStore(name).delete(id);
      }
    };
    await done;
    return existed;
  }
}

export const OFFLINE_CHARACTER_DATABASE = Object.freeze({ name: DB_NAME, version: DB_VERSION, stores: STORES });
