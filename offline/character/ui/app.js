import { OfflineCharacterDB } from "../../storage/indexeddb.js";
import { createProgressionCharacter, allocateStatPoints } from "../../game/progression/service.js";
import { getExperienceProgress, STAT_KEYS, STAT_LABELS } from "../../game/progression/rules.js";
import {
  exportCharacterBackup,
  importCharacterBackup,
  inspectCharacterBackup,
} from "../../storage/backup.js";

const CLASS_INFO = Object.freeze({
  knight: { label: "騎士", symbol: "⚔", description: "近身戰鬥" },
  elf: { label: "精靈", symbol: "❖", description: "敏捷與遠程" },
  wizard: { label: "法師", symbol: "✧", description: "魔法能力" },
  lord: { label: "領主", symbol: "♜", description: "均衡成長" },
});
const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const params = new URLSearchParams(location.search);
const dbName = params.get("dbName") || undefined;
const db = new OfflineCharacterDB(dbName ? { dbName } : undefined);

const elements = {
  status: document.querySelector("#appStatus"),
  createForm: document.querySelector("#createForm"),
  name: document.querySelector("#characterName"),
  classId: document.querySelector("#classId"),
  createButton: document.querySelector("#createButton"),
  count: document.querySelector("#characterCount"),
  empty: document.querySelector("#emptyState"),
  list: document.querySelector("#characterList"),
  selected: document.querySelector("#selectedPanel"),
  selectedTitle: document.querySelector("#selectedTitle"),
  selectedDetails: document.querySelector("#selectedDetails"),
  statDetails: document.querySelector("#statDetails"),
  experienceText: document.querySelector("#experienceText"),
  experienceFill: document.querySelector("#experienceFill"),
  statPointsLabel: document.querySelector("#statPointsLabel"),
  statAllocation: document.querySelector("#statAllocation"),
  enter: document.querySelector("#enterButton"),
  editPanel: document.querySelector("#editPanel"),
  editForm: document.querySelector("#editForm"),
  editId: document.querySelector("#editCharacterId"),
  editName: document.querySelector("#editName"),
  editClassId: document.querySelector("#editClassId"),
  cancelEdit: document.querySelector("#cancelEditButton"),
  exportBackup: document.querySelector("#exportBackupButton"),
  importBackup: document.querySelector("#importBackupButton"),
  importFile: document.querySelector("#importBackupFile"),
  installButton: document.querySelector("#installAppButton"),
  installStatus: document.querySelector("#installAppStatus"),
};

let characters = [];
let selectedCharacterId = null;
let isBusy = false;
let isBackupBusy = false;
let deferredInstallPrompt = null;

function setStatus(message, kind = "info") {
  elements.status.textContent = message;
  elements.status.dataset.kind = kind;
}
function setBusy(busy) {
  isBusy = busy;
  elements.createButton.disabled = busy || document.documentElement.dataset.ready !== "true";
  elements.createButton.textContent = busy ? "處理中……" : "建立角色";
}
function setBackupBusy(busy) {
  isBackupBusy = busy;
  elements.exportBackup.disabled = busy || document.documentElement.dataset.ready !== "true";
  elements.importBackup.disabled = busy || document.documentElement.dataset.ready !== "true";
  if (busy) {
    elements.createButton.disabled = true;
    elements.exportBackup.textContent = "處理中……";
  } else {
    elements.exportBackup.textContent = "下載存檔備份";
    elements.createButton.disabled = isBusy || document.documentElement.dataset.ready !== "true";
  }
}
function getClassInfo(classId) {
  return CLASS_INFO[classId] || { label: classId, symbol: "✦", description: "自訂職業" };
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "尚無紀錄" : date.toLocaleString("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}
function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function makeChip(text) {
  return createElement("span", "detail-chip", text);
}

function renderSelected() {
  const character = characters.find(item => item.characterId === selectedCharacterId);
  elements.selected.hidden = !character;
  if (!character) return;
  const classInfo = getClassInfo(character.classId);
  elements.selectedTitle.textContent = character.name;
  const progress = getExperienceProgress(character);
  const points = character.statPoints ?? 0;
  elements.selectedDetails.replaceChildren(
    makeChip(classInfo.label),
    makeChip("等級 Lv." + character.level),
    makeChip("HP " + character.hp.current + "/" + character.hp.max),
    makeChip("MP " + character.mp.current + "/" + character.mp.max),
    makeChip("金幣 " + character.gold),
  );
  elements.experienceText.textContent = progress.isMaxLevel
    ? "已達最高等級"
    : progress.current + " / " + progress.required;
  elements.experienceFill.style.width = progress.percent + "%";
  elements.statDetails.replaceChildren(...STAT_KEYS.map(key =>
    makeChip(STAT_LABELS[key] + " " + character.stats[key])
  ));
  elements.statPointsLabel.textContent = "可用能力點數：" + points;
  elements.statAllocation.replaceChildren();
  if (points > 0) {
    for (const key of STAT_KEYS) {
      const button = createElement("button", "small-button stat-add-button", STAT_LABELS[key] + " +1");
      button.type = "button";
      button.dataset.stat = key;
      elements.statAllocation.append(button);
    }
  }
}
function renderCharacters() {
  elements.count.textContent = characters.length + " 位";
  elements.empty.hidden = characters.length > 0;
  elements.list.replaceChildren();

  for (const character of characters) {
    const classInfo = getClassInfo(character.classId);
    const card = createElement("article", "character-card" + (character.characterId === selectedCharacterId ? " is-selected" : ""));
    card.dataset.characterId = character.characterId;

    const emblem = createElement("div", "class-emblem", classInfo.symbol);
    emblem.setAttribute("aria-hidden", "true");
    const copy = createElement("div", "character-copy");
    copy.append(
      createElement("h3", "", character.name),
      createElement("p", "", classInfo.label + " · Lv." + character.level + " · Job " + character.jobLevel),
      createElement("p", "", "HP " + character.hp.current + "/" + character.hp.max + " · MP " + character.mp.current + "/" + character.mp.max),
      createElement("p", "", "最後更新：" + formatDate(character.updatedAt)),
    );
    const actions = createElement("div", "character-actions");
    const selectButton = createElement("button", "small-button", character.characterId === selectedCharacterId ? "已選擇" : "選擇");
    selectButton.type = "button";
    selectButton.dataset.action = "select";
    selectButton.setAttribute("aria-label", "選擇角色 " + character.name);
    const editButton = createElement("button", "small-button", "編輯");
    editButton.type = "button";
    editButton.dataset.action = "edit";
    editButton.setAttribute("aria-label", "編輯角色 " + character.name);
    const deleteButton = createElement("button", "small-button danger", "刪除");
    deleteButton.type = "button";
    deleteButton.dataset.action = "delete";
    deleteButton.setAttribute("aria-label", "刪除角色 " + character.name);
    actions.append(selectButton, editButton, deleteButton);
    card.append(emblem, copy, actions);
    elements.list.append(card);
  }
  renderSelected();
}

async function refreshCharacters() {
  characters = await db.listCharacters();
  const savedSelection = await db.getSetting("selectedCharacterId", null);
  selectedCharacterId = characters.some(item => item.characterId === savedSelection) ? savedSelection : null;
  if (!selectedCharacterId && savedSelection !== null) await db.setSetting("selectedCharacterId", null);
  renderCharacters();
}
async function selectCharacter(characterId) {
  const character = characters.find(item => item.characterId === characterId);
  if (!character) throw new Error("找不到這個角色，請重新整理清單。");
  await db.setSetting("selectedCharacterId", characterId);
  selectedCharacterId = characterId;
  renderCharacters();
  setStatus("已選擇角色「" + character.name + "」。角色資料已保存在本機。", "success");
}
function openEdit(character) {
  elements.editId.value = character.characterId;
  elements.editName.value = character.name;
  elements.editClassId.value = CLASS_INFO[character.classId] ? character.classId : "knight";
  elements.editPanel.hidden = false;
  elements.editName.focus();
  elements.editPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function closeEdit() {
  elements.editPanel.hidden = true;
  elements.editForm.reset();
}
async function handleCardAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = button.closest("[data-character-id]");
  const characterId = card?.dataset.characterId;
  if (!characterId) return;
  const character = characters.find(item => item.characterId === characterId);
  if (!character) return;

  try {
    if (button.dataset.action === "select") {
      await selectCharacter(characterId);
    } else if (button.dataset.action === "edit") {
      openEdit(character);
    } else if (button.dataset.action === "delete") {
      const confirmed = window.confirm("確定刪除角色「" + character.name + "」嗎？這會一併刪除該角色的本機背包、裝備、技能及任務資料。");
      if (!confirmed) return;
      await db.deleteCharacter(characterId);
      if (selectedCharacterId === characterId) {
        selectedCharacterId = null;
        await db.setSetting("selectedCharacterId", null);
      }
      closeEdit();
      await refreshCharacters();
      setStatus("角色「" + character.name + "」已刪除。", "success");
    }
  } catch (error) {
    setStatus(error?.message || "操作失敗，請再試一次。", "error");
  }
}

async function downloadBackup() {
  if (isBackupBusy) return;
  setBackupBusy(true);
  try {
    const backup = await exportCharacterBackup(db);
    const json = JSON.stringify(backup, null, 2);
    const byteLength = new TextEncoder().encode(json).byteLength;
    if (byteLength > MAX_BACKUP_BYTES) throw new RangeError("備份檔超過 20 MB，請減少存檔資料後再試。");
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.href = objectUrl;
    link.download = "offline-adventure-save-" + timestamp + ".json";
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    setStatus("已下載完整備份，包含 " + backup.data.characters.length + " 位角色及所有存檔資料。", "success");
  } catch (error) {
    setStatus(error?.message || "下載備份失敗。", "error");
  } finally {
    setBackupBusy(false);
  }
}

async function importBackupFile(file) {
  if (!file) return;
  if (isBackupBusy) return;
  setBackupBusy(true);
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new RangeError("備份檔超過 20 MB，無法匯入。");
    const text = await file.text();
    let backup;
    try {
      backup = JSON.parse(text);
    } catch {
      throw new Error("備份 JSON 格式錯誤，請選擇正確的備份檔。");
    }
    const info = inspectCharacterBackup(backup);
    const createdAt = formatDate(info.exportedAt);
    const confirmed = window.confirm(
      "備份日期：" + createdAt + "\n" +
      "包含角色：" + info.characterCount + " 位\n\n" +
      "警告：匯入後會取代這個瀏覽器目前的所有角色、背包、裝備、技能、任務及設定。\n" +
      "建議先下載目前存檔備份。\n\n確定要還原這份備份嗎？",
    );
    if (!confirmed) {
      setStatus("已取消匯入，原有存檔沒有變更。", "info");
      return;
    }
    const result = await importCharacterBackup(db, backup, { replaceExisting: true });
    closeEdit();
    await refreshCharacters();
    setStatus("備份還原成功，已恢復 " + result.characterCount + " 位角色及其存檔資料。", "success");
  } catch (error) {
    setStatus(error?.message || "匯入備份失敗，原有存檔沒有變更。", "error");
  } finally {
    elements.importFile.value = "";
    setBackupBusy(false);
  }
}

elements.createForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (isBusy || isBackupBusy) return;
  setBusy(true);
  try {
    const character = await createProgressionCharacter(db, {
      name: elements.name.value,
      classId: elements.classId.value,
    });
    await db.setSetting("selectedCharacterId", character.characterId);
    await refreshCharacters();
    elements.createForm.reset();
    elements.classId.value = "knight";
    elements.name.focus();
    setStatus("角色「" + character.name + "」建立成功，已自動選擇。", "success");
  } catch (error) {
    setStatus(error?.message || "建立角色失敗。", "error");
  } finally {
    setBusy(false);
  }
});

elements.list.addEventListener("click", handleCardAction);

elements.statAllocation.addEventListener("click", async event => {
  const button = event.target.closest("button[data-stat]");
  if (!button || !selectedCharacterId) return;
  button.disabled = true;
  try {
    const updated = await allocateStatPoints(db, selectedCharacterId, button.dataset.stat, 1);
    await refreshCharacters();
    setStatus("已將 1 點能力點數分配至 " + STAT_LABELS[button.dataset.stat] + "。", "success");
  } catch (error) {
    setStatus(error?.message || "能力點數分配失敗。", "error");
  } finally {
    button.disabled = false;
  }
});

elements.editForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (isBackupBusy) return;
  const characterId = elements.editId.value;
  try {
    const existing = await db.getCharacter(characterId);
    const nextClassId = elements.editClassId.value;
    let updated;
    if (existing && existing.classId !== nextClassId) {
      const save = await db.loadCharacterSave(characterId);
      const skillPoints = (save.skills.points ?? 1) +
        (save.skills.learned ?? []).reduce((total, skill) => total + skill.level, 0);
      const result = await db.updateCharacterAndSaveData(
        characterId,
        {
          name: elements.editName.value,
          classId: nextClassId,
        },
        {
          skills: {
            points: Math.min(9999, skillPoints),
            learned: [],
            shortcuts: [],
            cooldowns: {},
          },
        },
      );
      updated = result.character;
      setStatus("角色已轉職；舊職業技能已重置並退還技能點數。", "success");
    } else {
      updated = await db.updateCharacter(characterId, {
        name: elements.editName.value,
        classId: nextClassId,
      });
      setStatus("角色「" + updated.name + "」已更新。", "success");
    }
    closeEdit();
    await refreshCharacters();
  } catch (error) {
    setStatus(error?.message || "更新角色失敗。", "error");
  }
});

elements.cancelEdit.addEventListener("click", closeEdit);
elements.enter.addEventListener("click", () => {
  const character = characters.find(item => item.characterId === selectedCharacterId);
  if (!character) {
    setStatus("請先選擇一位角色。", "error");
    return;
  }
  const target = new URL("../../game/index.html", location.href);
  if (dbName) target.searchParams.set("dbName", dbName);
  location.href = target.href;
});

elements.exportBackup.addEventListener("click", downloadBackup);
elements.importBackup.addEventListener("click", () => elements.importFile.click());
elements.importFile.addEventListener("change", async event => {
  await importBackupFile(event.target.files?.[0]);
});

window.addEventListener("pagehide", () => db.close());

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  elements.installButton.hidden = false;
  elements.installStatus.textContent = "瀏覽器已準備好安裝，可直接按下安裝按鈕。";
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  elements.installButton.hidden = true;
  elements.installStatus.textContent = "安裝完成！之後可從手機主畫面開啟單機冒險世界。";
});

elements.installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    elements.installStatus.textContent = "請使用瀏覽器選單中的「安裝應用程式」或「加到主畫面」。";
    return;
  }

  const promptEvent = deferredInstallPrompt;
  elements.installButton.disabled = true;
  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    elements.installStatus.textContent = choice?.outcome === "accepted"
      ? "已接受安裝要求；完成後可從手機主畫面開啟。"
      : "已取消安裝；你仍可依照上方步驟手動加入主畫面。";
  } catch (error) {
    elements.installStatus.textContent = "無法開啟安裝提示，請改用瀏覽器選單手動安裝。";
  } finally {
    deferredInstallPrompt = null;
    elements.installButton.hidden = true;
    elements.installButton.disabled = false;
  }
});

async function initialize(offlineShellPromise) {
  try {
    const [, offlineReady] = await Promise.all([db.open(), offlineShellPromise]);
    await refreshCharacters();
    document.documentElement.dataset.ready = "true";
    elements.createButton.disabled = false;
    elements.exportBackup.disabled = false;
    elements.importBackup.disabled = false;
    setStatus(
      offlineReady
        ? "本機角色資料庫已就緒，離線快取已完成。此頁不會連接原遊戲伺服器。"
        : "本機角色資料庫已就緒，但離線快取尚未完成；請保持連線並重新整理。",
      offlineReady ? "success" : "info",
    );
  } catch (error) {
    setStatus(error?.message || "無法開啟本機資料庫。請使用 localhost 或 HTTPS。", "error");
    document.documentElement.dataset.ready = "error";
  }
}

async function registerOfflineShell() {
  if (!("serviceWorker" in navigator)) return false;
  const scriptUrl = new URL("../../service-worker.js", location.href);
  const scopeUrl = new URL("../../", location.href);
  try {
    const registration = await navigator.serviceWorker.register(scriptUrl, { scope: scopeUrl.pathname });
    let timeoutId;
    const readyRegistration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise(resolve => {
        timeoutId = window.setTimeout(() => resolve(null), 15000);
      }),
    ]);
    if (timeoutId) window.clearTimeout(timeoutId);
    return Boolean(readyRegistration?.active || registration.active || navigator.serviceWorker.controller);
  } catch (error) {
    console.warn("本機離線快取無法啟用。", error);
    return Boolean(navigator.serviceWorker.controller);
  }
}

initialize(registerOfflineShell());
