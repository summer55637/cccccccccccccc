import { OfflineCharacterDB } from "../storage/indexeddb.js";
import { createProgressionCharacter, awardExperience } from "../game/progression/service.js";
import { getExperienceToNextLevel } from "../game/progression/rules.js";
import { getSkillBook, learnSkill, assignSkillShortcut, castSkill } from "../game/skills/service.js";
import { getSkillDefinition } from "../game/skills/definitions.js";
import { getMonsterWorldState } from "../game/combat/service.js";

const assert = {
  equal(actual, expected, message = "數值不相符。") {
    if (actual !== expected) throw new Error(message + " 實際：" + actual + "；預期：" + expected);
  },
  deepEqual(actual, expected, message = "資料內容不相符。") {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(message + " 實際：" + JSON.stringify(actual) + "；預期：" + JSON.stringify(expected));
    }
  },
};

function temporaryName() {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return "offline-skills-test-" + Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("無法清除技能測試資料庫。"));
    request.onblocked = () => reject(new Error("技能測試資料庫清除被阻擋。"));
  });
}
function sequence(values) {
  const remaining = [...values];
  return () => remaining.length ? remaining.shift() : 0.1;
}
async function expectReject(task, pattern, label) {
  try {
    await task();
  } catch (error) {
    if (!pattern.test(error.message)) {
      throw new Error(label + "：錯誤訊息不符，收到 " + error.message);
    }
    return;
  }
  throw new Error(label + "：預期拒絕但操作成功。");
}

export async function runSkillTests({ onLog = () => {} } = {}) {
  const dbName = temporaryName();
  const database = new OfflineCharacterDB({ dbName });
  const passed = [];
  const pass = label => {
    passed.push(label);
    onLog("✓ 技能：" + label);
  };

  try {
    await database.open();
    const knight = await createProgressionCharacter(database, {
      name: "技能騎士",
      classId: "knight",
    });
    let book = await getSkillBook(database, knight.characterId);
    assert.equal(book.points, 1);
    assert.equal(book.skills.length, 2);
    assert.equal(book.skills[0].skillId, "power-strike");
    assert.equal(book.skills[0].canLearn, true);
    pass("新角色取得 1 點起始技能點並載入職業技能");

    await database.saveCharacterData(knight.characterId, {
      skills: { learned: [] },
    });
    const legacySkillSave = await database.loadCharacterSave(knight.characterId);
    assert.equal(legacySkillSave.skills.points, 1);
    assert.deepEqual(legacySkillSave.skills.shortcuts, []);
    assert.deepEqual(legacySkillSave.skills.cooldowns, {});
    pass("只有舊版 learned 欄位的角色存檔會自動補齊新技能欄位");

    await expectReject(
      () => learnSkill(database, knight.characterId, "wind-arrow"),
      /不屬於目前角色的職業/,
      "跨職業技能",
    );
    await expectReject(
      () => learnSkill(database, knight.characterId, "shield-break"),
      /角色等級不足/,
      "高等技能等級限制",
    );
    pass("拒絕跨職業技能及未達等級的高階技能");

    await learnSkill(database, knight.characterId, "power-strike");
    book = await getSkillBook(database, knight.characterId);
    assert.equal(book.points, 0);
    assert.equal(book.skills.find(skill => skill.skillId === "power-strike").level, 1);
    await expectReject(
      () => learnSkill(database, knight.characterId, "power-strike"),
      /技能點數不足/,
      "技能點不足",
    );
    pass("學習技能會扣除技能點，點數不足時拒絕升級");

    await expectReject(
      () => assignSkillShortcut(database, knight.characterId, "shield-break", 1),
      /只能將已學習的技能/,
      "未學技能快捷欄",
    );
    await assignSkillShortcut(database, knight.characterId, "power-strike", 1);
    await expectReject(
      () => assignSkillShortcut(database, knight.characterId, "power-strike", 5),
      /1 到 4/,
      "技能快捷欄範圍",
    );
    book = await getSkillBook(database, knight.characterId);
    assert.deepEqual(book.shortcuts, [{ slot: 1, skillId: "power-strike" }]);
    pass("快捷欄只接受已學技能，並保存 1 到 4 號欄位");

    await database.updateCharacter(knight.characterId, {
      position: { x: 8, y: 5 },
      mp: { current: 0, max: knight.mp.max },
    });
    await expectReject(
      () => castSkill(database, knight.characterId, "power-strike", "slime-west", { now: 10000, random: () => 0.1 }),
      /MP 不足/,
      "MP 不足",
    );
    let save = await database.loadCharacterSave(knight.characterId);
    assert.equal(save.skills.cooldowns["power-strike"], undefined);
    assert.equal(save.character.mp.current, 0);
    pass("MP 不足時不消耗 MP，也不會錯誤啟動冷卻");

    await database.updateCharacter(knight.characterId, {
      mp: { current: 50, max: knight.mp.max },
    });
    await expectReject(
      () => castSkill(database, knight.characterId, "power-strike", "slime-south", { now: 10000, random: () => 0.1 }),
      /技能距離不足/,
      "技能射程限制",
    );
    save = await database.loadCharacterSave(knight.characterId);
    assert.equal(save.character.mp.current, 50);
    pass("近戰技能不能攻擊射程外怪物");

    const miss = await castSkill(
      database,
      knight.characterId,
      "power-strike",
      "slime-west",
      { now: 10000, random: sequence([0.99, 0.1]) },
    );
    assert.equal(miss.hit, false);
    assert.equal(miss.damage, 0);
    assert.equal(miss.mpCost, 5);
    assert.equal(miss.character.mp.current, 45);
    assert.equal(miss.counterAttack.hit, true);
    assert.equal(miss.character.hp.current, 99);
    pass("技能落空仍消耗 MP 並啟動冷卻，怪物會反擊");

    await expectReject(
      () => castSkill(database, knight.characterId, "power-strike", "slime-west", { now: 11000, random: () => 0.1 }),
      /技能冷卻中/,
      "技能冷卻",
    );
    pass("技能冷卻期間拒絕再次施放");

    const hit = await castSkill(
      database,
      knight.characterId,
      "power-strike",
      "slime-west",
      { now: 12300, random: () => 0.1 },
    );
    assert.equal(hit.hit, true);
    assert.equal(hit.defeated, true);
    assert.equal(hit.experience, 18);
    assert.equal(hit.loot.name, "透明凝膠");
    assert.equal(hit.character.mp.current, 40);
    assert.equal(hit.monster.hp, 0);
    pass("冷卻結束後施放技能可擊敗怪物並取得經驗與掉落");

    save = await database.loadCharacterSave(knight.characterId);
    assert.equal(save.skills.cooldowns["power-strike"], 14500);
    assert.deepEqual(save.skills.shortcuts, [{ slot: 1, skillId: "power-strike" }]);
    assert.equal(save.inventory.items.find(item => item.itemId === "slime-gel")?.count, 1);
    const world = await getMonsterWorldState(database, knight.characterId, 12301);
    assert.equal(world.find(monster => monster.spawnId === "slime-west").hp, 0);
    pass("技能冷卻、快捷欄、怪物死亡及背包掉落均已保存");

    const elf = await createProgressionCharacter(database, { name: "技能精靈", classId: "elf" });
    const level3Exp = getExperienceToNextLevel(1) + getExperienceToNextLevel(2);
    const levelUp = await awardExperience(database, elf.characterId, level3Exp);
    assert.equal(levelUp.character.level, 3);
    assert.equal(levelUp.skillPointsGained, 2);
    book = await getSkillBook(database, elf.characterId);
    assert.equal(book.points, 3);
    await expectReject(
      () => learnSkill(database, elf.characterId, "double-shot"),
      /前置技能條件/,
      "前置技能限制",
    );
    await learnSkill(database, elf.characterId, "wind-arrow");
    await expectReject(
      () => learnSkill(database, elf.characterId, "double-shot"),
      /前置技能條件/,
      "前置技能等級限制",
    );
    await learnSkill(database, elf.characterId, "wind-arrow");
    await learnSkill(database, elf.characterId, "double-shot");
    book = await getSkillBook(database, elf.characterId);
    assert.equal(book.points, 0);
    assert.equal(book.skills.find(skill => skill.skillId === "wind-arrow").level, 2);
    assert.equal(book.skills.find(skill => skill.skillId === "double-shot").level, 1);
    pass("升級取得技能點，並驗證技能等級與前置條件");

    const maxRank = book.skills.find(skill => skill.skillId === "double-shot");
    assert.equal(maxRank.level, 1);
    await expectReject(
      () => castSkill(database, elf.characterId, "double-shot", "boar-east", { now: 20000, random: () => 0.1 }),
      /技能距離不足/,
      "弓箭技能射程外目標",
    );
    pass("遠距職業技能保留職業射程規則");

    database.close();
    const reopened = new OfflineCharacterDB({ dbName });
    try {
      const restored = await getSkillBook(reopened, knight.characterId);
      assert.equal(restored.skills.find(skill => skill.skillId === "power-strike").level, 1);
      assert.deepEqual(restored.shortcuts, [{ slot: 1, skillId: "power-strike" }]);
      assert.equal(restored.cooldowns["power-strike"], 14500);
      const restoredElf = await getSkillBook(reopened, elf.characterId);
      assert.equal(restoredElf.points, 0);
      assert.equal(restoredElf.skills.find(skill => skill.skillId === "wind-arrow").level, 2);
      assert.equal(restoredElf.skills.find(skill => skill.skillId === "double-shot").level, 1);
      pass("重新開啟資料庫後技能點數、等級、快捷欄與冷卻持續保存");
    } finally {
      reopened.close();
    }

    onLog("全部通過：" + passed.length + " 項技能測試");
    return { passed: passed.length, failed: 0, results: passed };
  } finally {
    database.close();
    await deleteDatabase(dbName);
    onLog("已清除技能測試用臨時資料庫。");
  }
}
