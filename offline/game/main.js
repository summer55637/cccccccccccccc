import { OfflineCharacterDB } from "../storage/indexeddb.js";
import { getExperienceProgress, STAT_KEYS, STAT_LABELS } from "./progression/rules.js";

const CLASS_INFO = Object.freeze({
  knight: { label: "騎士", emblem: "⚔" },
  elf: { label: "精靈", emblem: "❖" },
  wizard: { label: "法師", emblem: "✧" },
  lord: { label: "領主", emblem: "♜" },
});
const params = new URLSearchParams(location.search);
const dbName = params.get("dbName") || undefined;
const database = new OfflineCharacterDB(dbName ? { dbName } : undefined);
const elements = {
  status: document.querySelector("#gameStatus"),
  empty: document.querySelector("#noCharacter"),
  layout: document.querySelector("#gameLayout"),
  name: document.querySelector("#characterName"),
  worldName: document.querySelector("#worldCharacterName"),
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
  avatar: document.querySelector("#worldAvatar"),
  position: document.querySelector("#positionText"),
  mapId: document.querySelector("#mapIdText"),
};

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
function renderCharacter(character) {
  const classInfo = CLASS_INFO[character.classId] || { label: character.classId, emblem: "✦" };
  const experience = getExperienceProgress(character);
  elements.name.textContent = character.name;
  elements.worldName.textContent = character.name;
  elements.class.textContent = classInfo.label + " · Lv." + character.level;
  elements.emblem.textContent = classInfo.emblem;
  elements.avatar.textContent = classInfo.emblem;
  elements.level.textContent = "Lv." + character.level;
  elements.jobLevel.textContent = "職業等級 " + character.jobLevel;
  elements.hpText.textContent = formatNumber(character.hp.current) + " / " + formatNumber(character.hp.max);
  elements.hpFill.style.width = percentage(character.hp.current, character.hp.max) + "%";
  elements.mpText.textContent = formatNumber(character.mp.current) + " / " + formatNumber(character.mp.max);
  elements.mpFill.style.width = percentage(character.mp.current, character.mp.max) + "%";
  elements.experienceText.textContent = experience.isMaxLevel
    ? "已達最高等級"
    : formatNumber(experience.current) + " / " + formatNumber(experience.required);
  elements.experienceFill.style.width = experience.percent + "%";
  elements.statPoints.textContent = (character.statPoints ?? 0) + " 點";
  elements.statGrid.replaceChildren(...STAT_KEYS.map(key => makeStat(key, character.stats[key])));
  elements.position.textContent = character.position.x + ", " + character.position.y;
  elements.mapId.textContent = character.mapId;
}

function goToLobby() {
  location.href = makeLobbyUrl();
}

document.querySelector("#returnToCharacters").addEventListener("click", goToLobby);
document.querySelector("#backToLobby").addEventListener("click", goToLobby);
document.querySelector("#goSelectCharacter").addEventListener("click", goToLobby);

document.querySelectorAll("button[data-feature]").forEach(button => {
  button.addEventListener("click", () => {
    const feature = button.dataset.feature;
    const names = {
      map: "地圖與角色移動",
      combat: "怪物與戰鬥",
      inventory: "背包與裝備",
      skills: "技能",
      quests: "任務",
    };
    document.querySelector("#adventureMessage").textContent =
      names[feature] + "尚未開發。單機版本會依照開發路線逐步加入，不會連接原伺服器。";
    setStatus(names[feature] + "功能尚未開放；目前角色資料已安全保存。", "info");
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
    renderCharacter(save.character);
    elements.layout.hidden = false;
    setStatus("已載入「" + save.character.name + "」的本機角色存檔。", "success");
    document.documentElement.dataset.ready = "true";
  } catch (error) {
    setStatus(error?.message || "無法讀取本機角色資料。請使用 localhost 或 HTTPS。", "error");
    document.documentElement.dataset.ready = "error";
  }
}

initialize();
