import { OfflineCharacterDB } from "../storage/indexeddb.js";
import { getExperienceProgress, STAT_KEYS, STAT_LABELS } from "./progression/rules.js";
import { getMapDefinition, getMapTile } from "./world/map.js";
import { moveCharacter } from "./world/movement.js";
import { attackMonster, getMonsterWorldState } from "./combat/service.js";
import { EQUIPMENT_SLOTS, ITEM_DEFINITIONS, getItemDefinition } from "./inventory/items.js";
import {
  dropItem,
  equipItem,
  getInventorySave,
  unequipItem,
  useItem,
} from "./inventory/service.js";
import {
  assignSkillShortcut,
  castSkill,
  getSkillBook,
  learnSkill,
} from "./skills/service.js";
import { getSkillDefinition } from "./skills/definitions.js";

const CLASS_INFO = Object.freeze({
  knight: { label: "騎士", emblem: "⚔" },
  elf: { label: "精靈", emblem: "❖" },
  wizard: { label: "法師", emblem: "✧" },
  lord: { label: "領主", emblem: "♜" },
});
const TILE_LABELS = Object.freeze({
  grass: "草地",
  path: "道路",
  tree: "樹木",
  rock: "岩石",
  water: "水域",
});
const params = new URLSearchParams(location.search);
const dbName = params.get("dbName") || undefined;
const database = new OfflineCharacterDB(dbName ? { dbName } : undefined);
const elements = {
  status: document.querySelector("#gameStatus"),
  empty: document.querySelector("#noCharacter"),
  layout: document.querySelector("#gameLayout"),
  name: document.querySelector("#characterName"),
  worldName: null,
  class: document.querySelector("#characterClass"),
  emblem: document.querySelector("#heroEmblem"),
  level: document.querySelector("#characterLevel"),
  jobLevel: document.querySelector("#jobLevel"),
  hpText: document.querySelector("#hpText"),
  hpFill: document.querySelector("#hpFill"),
  mpText: document.querySelector("#mpText"),
  mpFill: document.querySelector("#mpFill"),
  experienceText: document.querySelector("#experienceText"),
  experienceFill: document.querySelector("#experienceFill"),
  statPoints: document.querySelector("#statPointBadge"),
  statGrid: document.querySelector("#statGrid"),
  mapGrid: document.querySelector("#worldGrid"),
  position: document.querySelector("#positionText"),
  mapId: document.querySelector("#mapIdText"),
  movementControls: document.querySelector("#movementControls"),
  monsterList: document.querySelector("#monsterList"),
  combatSummary: document.querySelector("#combatSummary"),
  inventoryList: document.querySelector("#inventoryList"),
  inventoryCapacity: document.querySelector("#inventoryCapacity"),
  inventoryItemCount: document.querySelector("#inventoryItemCount"),
  equipmentSlots: document.querySelector("#equipmentSlots"),
  equipmentBonusText: document.querySelector("#equipmentBonusText"),
  skillPointBadge: document.querySelector("#skillPointBadge"),
  skillShortcuts: document.querySelector("#skillShortcuts"),
  skillList: document.querySelector("#skillList"),
};
let character = null;
let moving = false;
let playerMarker = null;
let monsters = [];
let attacking = false;
let inventoryBusy = false;
let skillBusy = false;

function setStatus(message, kind = "info") {
  elements.status.textContent = message;
  elements.status.dataset.kind = kind;
}
function percentage(current, maximum) {
  if (!Number.isFinite(current) || !Number.isFinite(maximum) || maximum <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((current / maximum) * 100)));
}
function formatNumber(value) {
  return new Intl.NumberFormat("zh-TW").format(value);
}
function makeStat(key, value) {
  const item = document.createElement("div");
  item.className = "stat-cell";
  const label = document.createElement("span");
  label.textContent = STAT_LABELS[key];
  const number = document.createElement("strong");
  number.textContent = String(value);
  item.append(label, number);
  return item;
}
function makeLobbyUrl() {
  const target = new URL("../character/ui/index.html", location.href);
  if (dbName) target.searchParams.set("dbName", dbName);
  return target.href;
}
function createPlayerMarker() {
  const marker = document.createElement("div");
  marker.id = "playerMarker";
  marker.className = "player-marker";
  marker.setAttribute("aria-label", "目前角色位置");

  const shadow = document.createElement("span");
  shadow.className = "player-shadow";
  shadow.setAttribute("aria-hidden", "true");
  const avatar = document.createElement("span");
  avatar.id = "worldAvatar";
  avatar.className = "player-icon";
  avatar.setAttribute("aria-hidden", "true");
  const name = document.createElement("span");
  name.id = "worldCharacterName";
  name.className = "player-name";
  marker.append(shadow, avatar, name);
  elements.worldName = name;
  return marker;
}
function createMonsterMarker(monster) {
  const marker = document.createElement("div");
  marker.className = "monster-marker";
  marker.dataset.spawnId = monster.spawnId;
  marker.style.gridColumnStart = String(monster.position.x + 1);
  marker.style.gridRowStart = String(monster.position.y + 1);
  marker.setAttribute("aria-label", monster.name + "，Lv." + monster.level);
  const icon = document.createElement("span");
  icon.className = "monster-icon";
  icon.textContent = monster.icon;
  const name = document.createElement("span");
  name.className = "monster-name";
  name.textContent = monster.name;
  marker.append(icon, name);
  return marker;
}
function renderMap(currentCharacter, currentMonsters = monsters) {
  const map = getMapDefinition(currentCharacter.mapId);
  elements.mapGrid.style.gridTemplateColumns = "repeat(" + map.width + ", minmax(0, 1fr))";
  elements.mapGrid.style.gridTemplateRows = "repeat(" + map.height + ", minmax(0, 1fr))";
  const tiles = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const tile = getMapTile(map.id, x, y);
      const element = document.createElement("div");
      element.className = "map-tile tile-" + tile.type;
      element.setAttribute("aria-hidden", "true");
      element.title = TILE_LABELS[tile.type] || "地圖邊界";
      element.dataset.x = String(x);
      element.dataset.y = String(y);
      tiles.push(element);
    }
  }
  const monsterMarkers = currentMonsters
    .filter(monster => monster.hp > 0)
    .map(createMonsterMarker);
  playerMarker = createPlayerMarker();
  elements.mapGrid.replaceChildren(...tiles, ...monsterMarkers, playerMarker);
  elements.mapId.textContent = map.name + " (" + map.id + ")";
  renderPosition(currentCharacter.position);
}
function renderPosition(position) {
  if (!playerMarker || !position) return;
  playerMarker.style.gridColumnStart = String(position.x + 1);
  playerMarker.style.gridRowStart = String(position.y + 1);
  playerMarker.setAttribute("aria-label", "角色位於 " + position.x + ", " + position.y);
  elements.position.textContent = position.x + ", " + position.y;
}
function renderMonsterList(currentMonsters = monsters) {
  if (!elements.monsterList || !elements.combatSummary) return;
  const alive = currentMonsters.filter(monster => monster.hp > 0);
  const defeated = currentMonsters.length - alive.length;
  elements.combatSummary.textContent = alive.length
    ? "移動到怪物旁邊（上下左右一格）即可攻擊；怪物靠近時會反擊。"
    : "附近怪物目前都已倒下，稍後會在原地重生。";
  const cards = currentMonsters.map(monster => {
    const card = document.createElement("article");
    card.className = "monster-card";
    card.dataset.spawnId = monster.spawnId;

    const heading = document.createElement("div");
    heading.className = "monster-card-heading";
    const title = document.createElement("strong");
    title.textContent = monster.name + " · Lv." + monster.level;
    const state = document.createElement("span");
    state.className = "monster-state state-" + monster.state;
    state.textContent = monster.hp <= 0
      ? "重生中"
      : monster.stateLabel;
    heading.append(title, state);

    const health = document.createElement("div");
    health.className = "monster-health";
    const healthLabel = document.createElement("span");
    healthLabel.textContent = monster.hp <= 0
      ? "等待重生 " + Math.ceil(monster.respawnRemainingMs / 1000) + " 秒"
      : "HP " + formatNumber(monster.hp) + " / " + formatNumber(monster.maxHp);
    const track = document.createElement("div");
    track.className = "monster-meter";
    const fill = document.createElement("span");
    fill.style.width = percentage(monster.hp, monster.maxHp) + "%";
    track.append(fill);
    health.append(healthLabel, track);

    const distance = document.createElement("p");
    distance.className = "monster-distance";
    distance.textContent = monster.hp <= 0
      ? "此處暫無怪物"
      : monster.distance === 0
        ? "怪物就在目前位置"
        : "距離 " + monster.distance + " 格";

    const attackButton = document.createElement("button");
    attackButton.type = "button";
    attackButton.className = "monster-attack-button";
    attackButton.dataset.attack = monster.spawnId;
    attackButton.disabled = monster.hp <= 0 || monster.distance > 1 || attacking || character?.hp.current <= 0;
    attackButton.textContent = monster.hp <= 0
      ? "重生中"
      : character?.hp.current <= 0
        ? "HP 不足"
        : monster.distance > 1
          ? "靠近後攻擊"
          : "普通攻擊";
    card.append(heading, health, distance, attackButton);
    return card;
  });
  elements.monsterList.replaceChildren(...cards);
  if (defeated > 0 && alive.length > 0) {
    elements.combatSummary.textContent += " 另有 " + defeated + " 隻怪物正在重生。";
  }
}
async function refreshCombatDisplay() {
  if (!character) return;
  monsters = await getMonsterWorldState(database, character.characterId);
  renderMap(character, monsters);
  renderMonsterList(monsters);
}
function createInventoryAction(label, action, itemId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "inventory-action action-" + action;
  button.dataset.inventoryAction = action;
  if (itemId) button.dataset.itemId = itemId;
  button.textContent = label;
  return button;
}
function inventoryItemName(itemId) {
  return Object.hasOwn(ITEM_DEFINITIONS, itemId) ? ITEM_DEFINITIONS[itemId].name : itemId;
}
function renderInventory(save) {
  if (!save || !elements.inventoryList) return;
  const inventory = save.inventory;
  const equipment = save.equipment;
  elements.inventoryCapacity.textContent = inventory.items.length + " / " + inventory.capacity + " 格";
  elements.inventoryItemCount.textContent = inventory.items.length + " 種";
  const cards = inventory.items.map(item => {
    const definition = Object.hasOwn(ITEM_DEFINITIONS, item.itemId)
      ? ITEM_DEFINITIONS[item.itemId]
      : {
          name: item.name || item.itemId,
          type: "material",
          description: "此道具來自匯入存檔，尚無使用或裝備資料。",
        };
    const card = document.createElement("article");
    card.className = "inventory-card";
    card.dataset.itemId = item.itemId;
    const heading = document.createElement("div");
    heading.className = "inventory-card-heading";
    const name = document.createElement("strong");
    name.textContent = definition.name;
    const count = document.createElement("span");
    count.className = "item-count";
    count.textContent = "×" + formatNumber(item.count);
    heading.append(name, count);
    const description = document.createElement("p");
    description.textContent = definition.description;
    const actions = document.createElement("div");
    actions.className = "inventory-actions";
    if (definition.type === "consumable") {
      actions.append(createInventoryAction("使用", "use", item.itemId));
    }
    if (definition.type === "equipment") {
      actions.append(createInventoryAction("裝備", "equip", item.itemId));
    }
    actions.append(createInventoryAction("丟棄 1 個", "drop", item.itemId));
    card.append(heading, description, actions);
    return card;
  });
  if (cards.length === 0) {
    const empty = document.createElement("p");
    empty.className = "inventory-empty";
    empty.textContent = "背包目前是空的。擊敗怪物可以取得材料。";
    cards.push(empty);
  }
  elements.inventoryList.replaceChildren(...cards);

  const slots = EQUIPMENT_SLOTS.map(({ slot, label }) => {
    const row = document.createElement("div");
    row.className = "equipment-slot";
    const slotName = document.createElement("span");
    slotName.textContent = label;
    const itemId = equipment.slots[slot];
    const itemName = document.createElement("strong");
    itemName.textContent = itemId ? inventoryItemName(itemId) : "尚未裝備";
    row.append(slotName, itemName);
    if (itemId) row.append(createInventoryAction("卸下", "unequip", slot));
    return row;
  });
  elements.equipmentSlots.replaceChildren(...slots);
  elements.equipmentBonusText.textContent =
    "攻擊加成 +" + save.equipmentBonuses.attackBonus +
    " · 防禦加成 +" + save.equipmentBonuses.defenseBonus;
}
async function refreshInventoryDisplay() {
  if (!character) return;
  const save = await getInventorySave(database, character.characterId);
  character = save.character;
  renderCharacter(character);
  renderInventory(save);
}
function createSkillAction(label, action, skillId, slot = null, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "skill-action action-" + action;
  button.dataset.skillAction = action;
  button.dataset.skillId = skillId;
  if (slot !== null) button.dataset.slot = String(slot);
  button.disabled = disabled;
  button.textContent = label;
  return button;
}
function renderSkillBook(book) {
  if (!book || !elements.skillList) return;
  elements.skillPointBadge.textContent = "技能點數 " + book.points;
  const shortcuts = [];
  for (let slot = 1; slot <= 4; slot += 1) {
    const assigned = book.shortcuts.find(item => item.slot === slot);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "skill-shortcut";
    button.dataset.castShortcut = String(slot);
    const skill = assigned && book.skills.find(item => item.skillId === assigned.skillId);
    button.disabled = !skill ||
      skillBusy ||
      book.character.hp.current <= 0 ||
      book.character.mp.current < skill.mpCost ||
      Date.now() < (book.cooldowns[skill.skillId] || 0);
    button.innerHTML = "";
    const slotLabel = document.createElement("small");
    slotLabel.textContent = "快捷 " + slot;
    const skillName = document.createElement("strong");
    skillName.textContent = skill ? skill.name + " Lv." + skill.level : "空位";
    button.append(slotLabel, skillName);
    shortcuts.push(button);
  }
  elements.skillShortcuts.replaceChildren(...shortcuts);

  const cards = book.skills.map(skill => {
    const card = document.createElement("article");
    card.className = "skill-card";
    card.dataset.skillId = skill.skillId;

    const heading = document.createElement("div");
    heading.className = "skill-card-heading";
    const name = document.createElement("strong");
    name.textContent = skill.name;
    const rank = document.createElement("span");
    rank.className = "skill-rank";
    rank.textContent = skill.learned ? "Lv." + skill.level + " / " + skill.maxLevel : "尚未學習";
    heading.append(name, rank);

    const description = document.createElement("p");
    description.textContent = skill.description;
    const details = document.createElement("p");
    details.className = "skill-details";
    const cooldownRemaining = Math.max(0, (book.cooldowns[skill.skillId] || 0) - Date.now());
    details.textContent =
      "MP " + skill.mpCost + " · 冷卻 " + (skill.cooldownMs / 1000).toFixed(1) +
      " 秒 · 距離 " + skill.range + " 格" +
      (cooldownRemaining > 0 ? " · 剩餘 " + Math.ceil(cooldownRemaining / 1000) + " 秒" : " · 可施放");

    const requirement = document.createElement("p");
    requirement.className = "skill-requirement";
    const nextLevel = skill.nextLevel;
    if (skill.maxed) {
      requirement.textContent = "已達最高等級";
    } else if (!skill.levelMet) {
      requirement.textContent = "需要角色 Lv." + skill.requiredLevel;
    } else if (!skill.prerequisiteMet) {
      requirement.textContent = "需要先提升前置技能";
    } else {
      requirement.textContent = skill.learned
        ? "升級需要 1 點技能點數"
        : "學習需要 1 點技能點數";
    }

    const actions = document.createElement("div");
    actions.className = "skill-actions";
    if (!skill.maxed) {
      actions.append(createSkillAction(
        skill.learned ? "升級技能" : "學習技能",
        "learn",
        skill.skillId,
        null,
        !skill.canLearn || skillBusy,
      ));
    }
    if (skill.learned) {
      actions.append(createSkillAction(
        "施放技能",
        "cast",
        skill.skillId,
        null,
        skillBusy || book.character.hp.current <= 0 || cooldownRemaining > 0 ||
          book.character.mp.current < skill.mpCost,
      ));
      for (let slot = 1; slot <= 4; slot += 1) {
        actions.append(createSkillAction(
          "設為快捷 " + slot,
          "assign",
          skill.skillId,
          slot,
          skillBusy,
        ));
      }
    }
    card.append(heading, description, details, requirement, actions);
    return card;
  });
  elements.skillList.replaceChildren(...cards);
}
async function refreshSkillDisplay() {
  if (!character) return;
  const book = await getSkillBook(database, character.characterId);
  renderSkillBook(book);
}
async function requestSkillAction(action, skillId, slot = null) {
  if (!character || skillBusy) return;
  if (action === "cast") {
    await requestCastSkill(skillId);
    return;
  }
  skillBusy = true;
  try {
    if (action === "learn") {
      await learnSkill(database, character.characterId, skillId);
      setStatus("已學習／提升技能「" + getSkillDefinition(skillId).name + "」。", "success");
    } else if (action === "assign") {
      await assignSkillShortcut(database, character.characterId, skillId, slot);
      setStatus("已將「" + getSkillDefinition(skillId).name + "」放入快捷欄 " + slot + "。", "success");
    }
    await refreshSkillDisplay();
  } catch (error) {
    setStatus(error?.message || "技能操作失敗。", "error");
  } finally {
    skillBusy = false;
    await refreshSkillDisplay();
  }
}
async function requestCastSkill(skillId) {
  if (!character || skillBusy) return;
  skillBusy = true;
  const skill = getSkillDefinition(skillId);
  const target = monsters
    .filter(monster => monster.hp > 0 && monster.distance <= skill.range)
    .sort((first, second) => first.distance - second.distance)[0];
  if (!target) {
    setStatus("技能範圍內沒有可攻擊的怪物。", "info");
    return;
  }
  skillBusy = true;
  try {
    const result = await castSkill(database, character.characterId, skillId, target.spawnId);
    character = result.character;
    await refreshCombatDisplay();
    renderCharacter(character);
    await refreshInventoryDisplay();
    await refreshSkillDisplay();

    let message = result.hit
      ? "施放「" + result.skillName + "」，對 " + target.name + " 造成 " + result.damage + " 點傷害。"
      : "施放「" + result.skillName + "」，但攻擊落空。";
    if (result.defeated) {
      message += " 擊敗怪物，獲得 " + formatNumber(result.experience) + " EXP。";
      if (result.loot?.added) message += " 取得「" + result.loot.name + "」。";
      else if (result.loot) message += " 背包已滿，未拾取「" + result.loot.name + "」。";
      if (result.levelUps.length) message += " 升級至 Lv." + character.level + "。";
    } else if (result.counterAttack.hit) {
      message += " 怪物反擊，造成 " + result.counterAttack.damage + " 點傷害。";
    }
    document.querySelector("#adventureMessage").textContent = message;
    setStatus(message, result.defeated ? "success" : "info");
  } catch (error) {
    setStatus(error?.message || "技能施放失敗。", "error");
  } finally {
    skillBusy = false;
    await refreshSkillDisplay();
  }
}
async function requestInventoryAction(action, value) {
  if (!character || inventoryBusy) return;
  if (action === "drop" && !window.confirm("確定丟棄 1 個「" + inventoryItemName(value) + "」？")) {
    return;
  }
  inventoryBusy = true;
  try {
    let message = "";
    if (action === "use") {
      const result = await useItem(database, character.characterId, value, 1);
      message = "使用 " + getItemDefinition(value).name + "，恢復 " +
        result.restored + (result.gauge === "hp" ? " HP。" : " MP。");
    } else if (action === "drop") {
      await dropItem(database, character.characterId, value, 1);
      message = "已丟棄 1 個「" + inventoryItemName(value) + "」。";
    } else if (action === "equip") {
      await equipItem(database, character.characterId, value);
      message = "已裝備「" + getItemDefinition(value).name + "」。";
    } else if (action === "unequip") {
      await unequipItem(database, character.characterId, value);
      message = "已卸下裝備。";
    } else {
      throw new Error("不支援的背包操作。");
    }
    await refreshInventoryDisplay();
    await refreshCombatDisplay();
    await refreshSkillDisplay();
    document.querySelector("#adventureMessage").textContent = message;
    setStatus(message, "success");
  } catch (error) {
    setStatus(error?.message || "背包操作失敗。", "error");
  } finally {
    inventoryBusy = false;
  }
}

function renderCharacter(currentCharacter) {
  const classInfo = CLASS_INFO[currentCharacter.classId] || {
    label: currentCharacter.classId,
    emblem: "✦",
  };
  const experience = getExperienceProgress(currentCharacter);
  elements.name.textContent = currentCharacter.name;
  elements.class.textContent = classInfo.label + " · Lv." + currentCharacter.level;
  elements.emblem.textContent = classInfo.emblem;
  elements.level.textContent = "Lv." + currentCharacter.level;
  elements.jobLevel.textContent = "職業等級 " + currentCharacter.jobLevel;
  elements.hpText.textContent = formatNumber(currentCharacter.hp.current) + " / " + formatNumber(currentCharacter.hp.max);
  elements.hpFill.style.width = percentage(currentCharacter.hp.current, currentCharacter.hp.max) + "%";
  elements.mpText.textContent = formatNumber(currentCharacter.mp.current) + " / " + formatNumber(currentCharacter.mp.max);
  elements.mpFill.style.width = percentage(currentCharacter.mp.current, currentCharacter.mp.max) + "%";
  elements.experienceText.textContent = experience.isMaxLevel
    ? "已達最高等級"
    : formatNumber(experience.current) + " / " + formatNumber(experience.required);
  elements.experienceFill.style.width = experience.percent + "%";
  elements.statPoints.textContent = (currentCharacter.statPoints ?? 0) + " 點";
  elements.statGrid.replaceChildren(...STAT_KEYS.map(key => makeStat(key, currentCharacter.stats[key])));
  renderMap(currentCharacter, monsters);
}
async function requestMove(direction) {
  if (!character || moving) return;
  moving = true;
  try {
    const blockedPositions = monsters
      .filter(monster => monster.hp > 0)
      .map(monster => monster.position);
    const result = await moveCharacter(database, character.characterId, direction, blockedPositions);
    if (!result.moved) {
      setStatus(result.reason, "info");
      document.querySelector("#adventureMessage").textContent = result.reason;
      return;
    }
    character = result.character;
    await refreshCombatDisplay();
    setStatus("已移動至座標 " + character.position.x + ", " + character.position.y + "；位置已自動保存。", "success");
    document.querySelector("#adventureMessage").textContent =
      "你目前位於新手村的 " + character.position.x + ", " + character.position.y + "。";
  } catch (error) {
    setStatus(error?.message || "移動失敗，角色位置沒有變更。", "error");
  } finally {
    moving = false;
  }
}
async function requestAttack(spawnId) {
  if (!character || attacking) return;
  attacking = true;
  renderMonsterList(monsters);
  try {
    const target = monsters.find(monster => monster.spawnId === spawnId);
    if (!target) throw new Error("找不到附近怪物。");
    const result = await attackMonster(database, character.characterId, spawnId);
    character = result.character;
    await refreshCombatDisplay();
    renderCharacter(character);
    renderMonsterList(monsters);
    await refreshInventoryDisplay();
    await refreshSkillDisplay();

    let message;
    if (result.defeated) {
      message = "擊敗 " + target.name + "！獲得 " + formatNumber(result.experience) + " EXP。";
      if (result.loot?.added) message += " 取得「" + result.loot.name + "」。";
      else if (result.loot) message += " 背包空間不足，未能拾取「" + result.loot.name + "」。";
      if (result.levelUps.length) message += " 升級至 Lv." + character.level + "！";
    } else if (!result.hit) {
      message = "攻擊落空！";
    } else {
      message = "你對 " + target.name + " 造成 " + result.damage + " 點傷害。";
    }
    if (result.counterAttack.hit) {
      message += " 怪物反擊，造成 " + result.counterAttack.damage + " 點傷害。";
    }
    document.querySelector("#adventureMessage").textContent = message;
    setStatus(message, result.defeated ? "success" : "info");
  } catch (error) {
    setStatus(error?.message || "攻擊失敗。", "error");
  } finally {
    attacking = false;
    renderMonsterList(monsters);
  }
}
function directionFromKey(key) {
  switch (key.toLowerCase()) {
    case "arrowup":
    case "w": return "up";
    case "arrowdown":
    case "s": return "down";
    case "arrowleft":
    case "a": return "left";
    case "arrowright":
    case "d": return "right";
    default: return null;
  }
}
function goToLobby() {
  location.href = makeLobbyUrl();
}

document.querySelector("#returnToCharacters").addEventListener("click", goToLobby);
document.querySelector("#backToLobby").addEventListener("click", goToLobby);
document.querySelector("#goSelectCharacter").addEventListener("click", goToLobby);

elements.movementControls.addEventListener("click", event => {
  const button = event.target.closest("button[data-move]");
  if (button) requestMove(button.dataset.move);
});
elements.monsterList.addEventListener("click", event => {
  const button = event.target.closest("button[data-attack]");
  if (button && !button.disabled) requestAttack(button.dataset.attack);
});
elements.inventoryList.addEventListener("click", event => {
  const button = event.target.closest("button[data-inventory-action]");
  if (button && !button.disabled) {
    requestInventoryAction(button.dataset.inventoryAction, button.dataset.itemId);
  }
});
elements.equipmentSlots.addEventListener("click", event => {
  const button = event.target.closest("button[data-inventory-action='unequip']");
  if (button && !button.disabled) requestInventoryAction("unequip", button.dataset.itemId);
});
elements.skillList.addEventListener("click", event => {
  const button = event.target.closest("button[data-skill-action]");
  if (button && !button.disabled) {
    requestSkillAction(button.dataset.skillAction, button.dataset.skillId, Number(button.dataset.slot) || null);
  }
});
elements.skillShortcuts.addEventListener("click", event => {
  const button = event.target.closest("button[data-cast-shortcut]");
  if (!button || button.disabled) return;
  const slot = Number(button.dataset.castShortcut);
  getSkillBook(database, character.characterId).then(book => {
    const assigned = book.shortcuts.find(item => item.slot === slot);
    if (assigned) requestCastSkill(assigned.skillId);
  }).catch(error => setStatus(error?.message || "無法讀取技能快捷欄。", "error"));
});
window.addEventListener("keydown", event => {
  const direction = directionFromKey(event.key);
  if (!direction || event.repeat) return;
  if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
  event.preventDefault();
  requestMove(direction);
});

document.querySelectorAll("button[data-feature]").forEach(button => {
  button.addEventListener("click", () => {
    const feature = button.dataset.feature;
    if (feature === "map") {
      setStatus("使用鍵盤方向鍵／W A S D，或點選畫面下方方向按鈕移動。", "success");
      elements.movementControls.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (feature === "combat") {
      setStatus("靠近怪物後可使用普通攻擊；怪物會依距離進入待機、警戒或攻擊狀態。", "success");
      document.querySelector("#combatPanel").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (feature === "inventory") {
      setStatus("可使用藥水、裝備武器防具，或丟棄不需要的道具。", "success");
      document.querySelector("#inventoryPanel").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (feature === "skills") {
      setStatus("學習職業技能、分配快捷欄，並對技能範圍內最近的怪物施放。", "success");
      document.querySelector("#skillPanel").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const names = {
      combat: "怪物與戰鬥",
      inventory: "背包與裝備",
      skills: "技能",
      quests: "任務",
    };
    document.querySelector("#adventureMessage").textContent =
      names[feature] + "尚未開發，會在後續階段加入。移動與目前位置已可在本機保存。";
    setStatus(names[feature] + "功能尚未開放；角色資料已安全保存。", "info");
  });
});

window.addEventListener("pagehide", () => database.close());

async function initialize() {
  try {
    await database.open();
    const selectedId = await database.getSetting("selectedCharacterId", null);
    const save = selectedId ? await database.loadCharacterSave(selectedId) : null;
    if (!save?.character) {
      elements.empty.hidden = false;
      setStatus("沒有找到已選擇的角色，請返回角色選擇畫面。", "error");
      document.documentElement.dataset.ready = "empty";
      return;
    }
    character = save.character;
    monsters = await getMonsterWorldState(database, character.characterId);
    renderCharacter(character);
    renderMonsterList(monsters);
    renderInventory(await getInventorySave(database, character.characterId));
    await refreshSkillDisplay();
    elements.layout.hidden = false;
    setStatus("已載入「" + character.name + "」的本機角色存檔。可以探索並攻擊怪物。", "success");
    document.documentElement.dataset.ready = "true";
  } catch (error) {
    setStatus(error?.message || "無法讀取本機角色資料。請使用 localhost 或 HTTPS。", "error");
    document.documentElement.dataset.ready = "error";
  }
}

initialize();
