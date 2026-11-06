import { OFFLINE_CHARACTER_DATABASE } from "./indexeddb.js";

const BACKUP_FORMAT = "offline-adventure-save";
const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const MAX_CHARACTERS = 500;
const MAX_SETTINGS = 1000;
const STAT_NAMES = ["str", "dex", "int", "agi", "vit", "luk"];
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const STORE = OFFLINE_CHARACTER_DATABASE.stores;
const STORE_NAMES = [
  STORE.characters, STORE.inventories, STORE.equipment,
  STORE.skills, STORE.quests, STORE.settings,
];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function assertObject(value, label) {
  if (!isObject(value)) throw new TypeError(label + "必須是一般物件。");
}

function assertKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(label + "包含不支援的欄位：" + key);
  }
}

function assertText(value, label, maxLength) {
  if (typeof value !== "string") throw new TypeError(label + "必須是文字。");
  const text = value.trim();
  if (!text || Array.from(text).length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new Error(label + "不可空白、過長或含控制字元。");
  }
  return text;
}

function assertInteger(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(label + "必須是 " + min + " 到 " + max + " 之間的整數。");
  }
  return value;
}

function assertDate(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(label + "不是有效日期。");
  }
  return value;
}

function cloneAndInspect(value) {
  let raw;
  try {
    raw = JSON.stringify(value);
  } catch {
    throw new TypeError("備份不是有效的 JSON 資料。");
  }
  if (!raw || raw.length > MAX_BACKUP_BYTES) {
    throw new RangeError("備份檔不能為空，且不可超過 20 MB。");
  }
  let copy;
  try {
    copy = JSON.parse(raw);
  } catch {
    throw new TypeError("備份 JSON 格式錯誤。");
  }
  const inspect = (node, depth) => {
    if (depth > 32) throw new RangeError("備份資料巢狀層級過深。");
    if (Array.isArray(node)) {
      if (node.length > 100000) throw new RangeError("備份陣列項目過多。");
      for (const item of node) inspect(item, depth + 1);
      return;
    }
    if (node && typeof node === "object") {
      for (const key of Object.keys(node)) {
        if (DANGEROUS_KEYS.has(key)) throw new Error("備份含有不允許的欄位。");
        inspect(node[key], depth + 1);
      }
    }
  };
  inspect(copy, 0);
  return copy;
}

function normalizeCharacter(input, ids, names) {
  assertObject(input, "角色資料");
  const allowed = [
    "schemaVersion", "characterId", "name", "nameKey", "classId", "level",
    "jobLevel", "experience", "statPoints", "stats", "hp", "mp", "mapId", "position",
    "gold", "playTimeSeconds", "createdAt", "updatedAt",
  ];
  assertKeys(input, allowed, "角色資料");
  if (input.schemaVersion !== 1) throw new Error("不支援的角色資料版本。");
  const characterId = assertText(input.characterId, "角色 ID", 128);
  if (ids.has(characterId)) throw new Error("備份中有重複角色 ID。");
  ids.add(characterId);

  const name = assertText(input.name, "角色名稱", 16);
  const nameKey = name.toLocaleLowerCase();
  if (names.has(nameKey)) throw new Error("備份中有重複角色名稱：" + name);
  names.add(nameKey);
  if (input.nameKey !== nameKey) throw new Error("角色名稱索引資料不正確。");

  const classId = assertText(input.classId, "職業代碼", 32);
  if (!/^[a-zA-Z0-9_-]+$/.test(classId)) throw new Error("職業代碼格式錯誤。");

  assertObject(input.stats, "角色能力值");
  assertKeys(input.stats, STAT_NAMES, "角色能力值");
  const stats = {};
  for (const key of STAT_NAMES) stats[key] = assertInteger(input.stats[key], "能力值 " + key, 1, 9999);

  const gauge = (value, label) => {
    assertObject(value, label);
    assertKeys(value, ["current", "max"], label);
    const max = assertInteger(value.max, label + "最大值", 1, 2000000000);
    return { current: assertInteger(value.current, label + "目前值", 0, max), max };
  };
  assertObject(input.position, "角色座標");
  assertKeys(input.position, ["x", "y"], "角色座標");
  for (const axis of ["x", "y"]) {
    if (!Number.isFinite(input.position[axis]) || Math.abs(input.position[axis]) > 10000000) {
      throw new RangeError("角色座標資料超出範圍。");
    }
  }

  return {
    schemaVersion: 1,
    characterId,
    name,
    nameKey,
    classId,
    level: assertInteger(input.level, "角色等級", 1, 100000),
    jobLevel: assertInteger(input.jobLevel, "職業等級", 1, 100000),
    experience: assertInteger(input.experience, "經驗值", 0, Number.MAX_SAFE_INTEGER),
    statPoints: input.statPoints === undefined ? 0 : assertInteger(input.statPoints, "能力點數", 0, 9999),
    stats,
    hp: gauge(input.hp, "HP"),
    mp: gauge(input.mp, "MP"),
    mapId: assertText(input.mapId, "地圖代碼", 64),
    position: { x: input.position.x, y: input.position.y },
    gold: assertInteger(input.gold, "金幣", 0, Number.MAX_SAFE_INTEGER),
    playTimeSeconds: assertInteger(input.playTimeSeconds, "遊戲時間", 0, Number.MAX_SAFE_INTEGER),
    createdAt: assertDate(input.createdAt, "角色建立時間"),
    updatedAt: assertDate(input.updatedAt, "角色更新時間"),
  };
}

function normalizePartRecords(records, label, characterIds, normalize) {
  if (!Array.isArray(records) || records.length > MAX_CHARACTERS) {
    throw new TypeError(label + "必須是合理大小的陣列。");
  }
  const seen = new Set();
  const result = records.map(record => {
    assertObject(record, label + "資料");
    const characterId = assertText(record.characterId, label + "角色 ID", 128);
    if (!characterIds.has(characterId)) throw new Error(label + "包含不存在的角色。");
    if (seen.has(characterId)) throw new Error(label + "有重複角色資料。");
    seen.add(characterId);
    return normalize(record, characterId);
  });
  return { records: result, seen };
}

function normalizeBackup(input) {
  const backup = cloneAndInspect(input);
  assertObject(backup, "備份檔");
  assertKeys(backup, ["format", "version", "exportedAt", "data"], "備份檔");
  if (backup.format !== BACKUP_FORMAT) throw new Error("這不是單機冒險世界的備份檔。");
  if (backup.version !== BACKUP_VERSION) throw new Error("備份版本不相容，請使用相同或更新版本的遊戲。");
  assertDate(backup.exportedAt, "備份建立時間");
  assertObject(backup.data, "備份內容");
  assertKeys(backup.data, ["characters", "inventories", "equipment", "skills", "quests", "settings"], "備份內容");

  const source = backup.data;
  if (!Array.isArray(source.characters) || source.characters.length > MAX_CHARACTERS) {
    throw new RangeError("角色數量不可超過 " + MAX_CHARACTERS + " 位。");
  }
  const ids = new Set();
  const names = new Set();
  const characters = source.characters.map(item => normalizeCharacter(item, ids, names));
  const characterIds = new Set(characters.map(item => item.characterId));

  const inventory = normalizePartRecords(source.inventories, "背包", characterIds, (record, characterId) => {
    assertKeys(record, ["characterId", "capacity", "items"], "背包資料");
    const capacity = assertInteger(record.capacity, "背包容量", 1, 5000);
    if (!Array.isArray(record.items) || record.items.length > 5000) throw new TypeError("背包道具清單格式錯誤。");
    const items = record.items.map((item, index) => {
      assertObject(item, "第 " + (index + 1) + " 個道具");
      assertText(item.itemId, "道具代碼", 128);
      assertInteger(item.count, "道具數量", 1, 2000000000);
      return item;
    });
    return { characterId, capacity, items };
  });
  const equipment = normalizePartRecords(source.equipment, "裝備", characterIds, (record, characterId) => {
    assertKeys(record, ["characterId", "slots"], "裝備資料");
    assertObject(record.slots, "裝備欄位");
    return { characterId, slots: record.slots };
  });
  const skills = normalizePartRecords(source.skills, "技能", characterIds, (record, characterId) => {
    assertKeys(record, ["characterId", "points", "learned", "shortcuts", "cooldowns"], "技能資料");
    const points = record.points === undefined ? 1 : assertInteger(record.points, "技能點數", 0, 9999);
    const learnedInput = record.learned ?? [];
    if (!Array.isArray(learnedInput) || learnedInput.length > 200) {
      throw new TypeError("技能清單格式錯誤。");
    }
    const learnedIds = new Set();
    const learned = learnedInput.map((entry, index) => {
      assertObject(entry, "第 " + (index + 1) + " 個技能紀錄");
      assertKeys(entry, ["skillId", "level"], "技能紀錄");
      const skillId = assertText(entry.skillId, "技能 ID", 128);
      if (learnedIds.has(skillId)) throw new Error("備份中的技能不可重複。");
      learnedIds.add(skillId);
      return {
        skillId,
        level: assertInteger(entry.level, "技能等級", 1, 10),
      };
    });
    const shortcutsInput = record.shortcuts ?? [];
    if (!Array.isArray(shortcutsInput) || shortcutsInput.length > 4) {
      throw new TypeError("技能快捷欄最多只能有 4 個。");
    }
    const shortcutSlots = new Set();
    const shortcuts = shortcutsInput.map((entry, index) => {
      assertObject(entry, "第 " + (index + 1) + " 個技能快捷欄");
      assertKeys(entry, ["slot", "skillId"], "技能快捷欄");
      const slot = assertInteger(entry.slot, "技能快捷欄位", 1, 4);
      const skillId = assertText(entry.skillId, "快捷技能 ID", 128);
      if (shortcutSlots.has(slot)) throw new Error("備份中的技能快捷欄位不可重複。");
      if (!learnedIds.has(skillId)) throw new Error("技能快捷欄只能放入已學習技能。");
      shortcutSlots.add(slot);
      return { slot, skillId };
    });
    const cooldownsInput = record.cooldowns ?? {};
    assertObject(cooldownsInput, "技能冷卻資料");
    const cooldowns = {};
    for (const [skillIdInput, expiresAtInput] of Object.entries(cooldownsInput)) {
      const skillId = assertText(skillIdInput, "冷卻技能 ID", 128);
      cooldowns[skillId] = assertInteger(expiresAtInput, "技能冷卻時間", 0, Number.MAX_SAFE_INTEGER);
    }
    return { characterId, points, learned, shortcuts, cooldowns };
  });
  const quests = normalizePartRecords(source.quests, "任務", characterIds, (record, characterId) => {
    assertKeys(record, ["characterId", "entries"], "任務資料");
    if (!Array.isArray(record.entries) || record.entries.length > 10000) throw new TypeError("任務清單格式錯誤。");
    return { characterId, entries: record.entries };
  });

  const settingsInput = source.settings;
  if (!Array.isArray(settingsInput) || settingsInput.length > MAX_SETTINGS) {
    throw new TypeError("遊戲設定資料格式錯誤。");
  }
  const settingKeys = new Set();
  const settings = settingsInput.map(record => {
    assertObject(record, "設定資料");
    assertKeys(record, ["key", "value", "updatedAt"], "設定資料");
    const key = assertText(record.key, "設定名稱", 128);
    if (settingKeys.has(key)) throw new Error("備份中有重複設定：" + key);
    settingKeys.add(key);
    assertDate(record.updatedAt, "設定更新時間");
    const serialized = JSON.stringify(record.value);
    if (serialized === undefined || serialized.length > 16384) throw new RangeError("單筆設定值不可超過 16 KB。");
    return { key, value: record.value, updatedAt: record.updatedAt };
  });

  const selected = settings.find(item => item.key === "selectedCharacterId");
  if (selected && selected.value !== null && !characterIds.has(selected.value)) {
    throw new Error("備份中的目前選擇角色不存在。");
  }

  const ensureDefault = (result, seen, makeDefault) => {
    for (const character of characters) {
      if (!seen.has(character.characterId)) result.push(makeDefault(character.characterId));
    }
  };
  ensureDefault(inventory.records, inventory.seen, id => ({ characterId: id, capacity: 100, items: [] }));
  ensureDefault(equipment.records, equipment.seen, id => ({ characterId: id, slots: {} }));
  ensureDefault(skills.records, skills.seen, id => ({
    characterId: id, points: 1, learned: [], shortcuts: [], cooldowns: {},
  }));
  ensureDefault(quests.records, quests.seen, id => ({ characterId: id, entries: [] }));

  return {
    exportedAt: backup.exportedAt,
    data: {
      characters,
      inventories: inventory.records,
      equipment: equipment.records,
      skills: skills.records,
      quests: quests.records,
      settings,
    },
  };
}

export function inspectCharacterBackup(input) {
  const normalized = normalizeBackup(input);
  return {
    exportedAt: normalized.exportedAt,
    characterCount: normalized.data.characters.length,
    inventoryCount: normalized.data.inventories.length,
    equipmentCount: normalized.data.equipment.length,
    skillCount: normalized.data.skills.length,
    questCount: normalized.data.quests.length,
    settingCount: normalized.data.settings.length,
  };
}

export async function exportCharacterBackup(database) {
  if (!database || typeof database.open !== "function") throw new TypeError("請提供本機角色資料庫。");
  await database.open();
  const nativeDb = database.db;
  if (!nativeDb) throw new Error("本機資料庫尚未開啟。");
  const tx = nativeDb.transaction(STORE_NAMES, "readonly");
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error("讀取備份資料失敗。"));
    tx.onerror = () => {};
  });
  const read = name => new Promise((resolve, reject) => {
    const request = tx.objectStore(name).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("讀取備份資料失敗。"));
  });
  const values = await Promise.all(STORE_NAMES.map(read));
  await done;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      characters: values[0],
      inventories: values[1],
      equipment: values[2],
      skills: values[3],
      quests: values[4],
      settings: values[5],
    },
  };
}

/**
 * Restore a complete backup atomically. The caller must obtain explicit user
 * confirmation and pass replaceExisting: true before local data is replaced.
 */
export async function importCharacterBackup(database, input, options = {}) {
  if (!database || typeof database.open !== "function") throw new TypeError("請提供本機角色資料庫。");
  if (!isObject(options) || options.replaceExisting !== true) {
    throw new Error("匯入會取代目前本機存檔；取得使用者確認後才可執行。");
  }
  const normalized = normalizeBackup(input);
  await database.open();
  const nativeDb = database.db;
  if (!nativeDb) throw new Error("本機資料庫尚未開啟。");

  const tx = nativeDb.transaction(STORE_NAMES, "readwrite");
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error("還原存檔失敗，原有資料未完整變更。"));
    tx.onerror = () => {};
  });
  for (const name of STORE_NAMES) tx.objectStore(name).clear();
  const data = normalized.data;
  const collections = [
    [STORE.characters, data.characters],
    [STORE.inventories, data.inventories],
    [STORE.equipment, data.equipment],
    [STORE.skills, data.skills],
    [STORE.quests, data.quests],
    [STORE.settings, data.settings],
  ];
  for (const [storeName, records] of collections) {
    const objectStore = tx.objectStore(storeName);
    for (const record of records) objectStore.put(record);
  }
  await done;
  return {
    characterCount: data.characters.length,
    exportedAt: normalized.exportedAt,
  };
}
