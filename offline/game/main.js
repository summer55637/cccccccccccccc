import { OfflineCharacterDB } from "../storage/indexeddb.js";
import { getExperienceProgress, STAT_KEYS, STAT_LABELS } from "./progression/rules.js";
import { getMapDefinition, getMapTile } from "./world/map.js";
import { moveCharacter } from "./world/movement.js";

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
};
let character = null;
let moving = false;
let playerMarker = null;

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
function renderMap(currentCharacter) {
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
  playerMarker = createPlayerMarker();
  elements.mapGrid.replaceChildren(...tiles, playerMarker);
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
  renderMap(currentCharacter);
}
async function requestMove(direction) {
  if (!character || moving) return;
  moving = true;
  try {
    const result = await moveCharacter(database, character.characterId, direction);
    if (!result.moved) {
      setStatus(result.reason, "info");
      document.querySelector("#adventureMessage").textContent = result.reason;
      return;
    }
    character = result.character;
    renderPosition(character.position);
    setStatus("已移動至座標 " + character.position.x + ", " + character.position.y + "；位置已自動保存。", "success");
    document.querySelector("#adventureMessage").textContent =
      "你目前位於新手村的 " + character.position.x + ", " + character.position.y + "。";
  } catch (error) {
    setStatus(error?.message || "移動失敗，角色位置沒有變更。", "error");
  } finally {
    moving = false;
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
    renderCharacter(character);
    elements.layout.hidden = false;
    setStatus("已載入「" + character.name + "」的本機角色存檔。可以開始移動。", "success");
    document.documentElement.dataset.ready = "true";
  } catch (error) {
    setStatus(error?.message || "無法讀取本機角色資料。請使用 localhost 或 HTTPS。", "error");
    document.documentElement.dataset.ready = "error";
  }
}

initialize();
