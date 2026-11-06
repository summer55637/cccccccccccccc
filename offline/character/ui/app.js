import { OfflineCharacterDB } from "../../storage/indexeddb.js";

const CLASS_INFO = Object.freeze({
  knight: { label: "騎士", symbol: "⚔", description: "近身戰鬥" },
  elf: { label: "精靈", symbol: "❖", description: "敏捷與遠程" },
  wizard: { label: "法師", symbol: "✧", description: "魔法能力" },
  lord: { label: "領主", symbol: "♜", description: "均衡成長" },
});
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
  enter: document.querySelector("#enterButton"),
  editPanel: document.querySelector("#editPanel"),
  editForm: document.querySelector("#editForm"),
  editId: document.querySelector("#editCharacterId"),
  editName: document.querySelector("#editName"),
  editClassId: document.querySelector("#editClassId"),
  cancelEdit: document.querySelector("#cancelEditButton"),
};

let characters = [];
let selectedCharacterId = null;
let isBusy = false;

function setStatus(message, kind = "info") {
  elements.status.textContent = message;
  elements.status.dataset.kind = kind;
}
function setBusy(busy) {
  isBusy = busy;
  elements.createButton.disabled = busy;
  elements.createButton.textContent = busy ? "處理中……" : "建立角色";
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
  elements.selectedDetails.replaceChildren(
    makeChip(classInfo.label),
    makeChip(`等級 Lv.${character.level}`),
    makeChip(`HP ${character.hp.current}/${character.hp.max}`),
    makeChip(`MP ${character.mp.current}/${character.mp.max}`),
    makeChip(`金幣 ${character.gold}`),
  );
}
function renderCharacters() {
  elements.count.textContent = `${characters.length} 位`;
  elements.empty.hidden = characters.length > 0;
  elements.list.replaceChildren();

  for (const character of characters) {
    const classInfo = getClassInfo(character.classId);
    const card = createElement("article", `character-card${character.characterId === selectedCharacterId ? " is-selected" : ""}`);
    card.dataset.characterId = character.characterId;

    const emblem = createElement("div", "class-emblem", classInfo.symbol);
    emblem.setAttribute("aria-hidden", "true");
    const copy = createElement("div", "character-copy");
    copy.append(
      createElement("h3", "", character.name),
      createElement("p", "", `${classInfo.label} · Lv.${character.level} · Job ${character.jobLevel}`),
      createElement("p", "", `HP ${character.hp.current}/${character.hp.max} · MP ${character.mp.current}/${character.mp.max}`),
      createElement("p", "", `最後更新：${formatDate(character.updatedAt)}`),
    );
    const actions = createElement("div", "character-actions");
    const selectButton = createElement("button", "small-button", character.characterId === selectedCharacterId ? "已選擇" : "選擇");
    selectButton.type = "button";
    selectButton.dataset.action = "select";
    selectButton.setAttribute("aria-label", `選擇角色 ${character.name}`);
    const editButton = createElement("button", "small-button", "編輯");
    editButton.type = "button";
    editButton.dataset.action = "edit";
    editButton.setAttribute("aria-label", `編輯角色 ${character.name}`);
    const deleteButton = createElement("button", "small-button danger", "刪除");
    deleteButton.type = "button";
    deleteButton.dataset.action = "delete";
    deleteButton.setAttribute("aria-label", `刪除角色 ${character.name}`);
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
  setStatus(`已選擇角色「${character.name}」。角色資料已保存在本機。`, "success");
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
      const confirmed = window.confirm(`確定刪除角色「${character.name}」嗎？這會一併刪除該角色的本機背包、裝備、技能及任務資料。`);
      if (!confirmed) return;
      await db.deleteCharacter(characterId);
      if (selectedCharacterId === characterId) {
        selectedCharacterId = null;
        await db.setSetting("selectedCharacterId", null);
      }
      closeEdit();
      await refreshCharacters();
      setStatus(`角色「${character.name}」已刪除。`, "success");
    }
  } catch (error) {
    setStatus(error?.message || "操作失敗，請再試一次。", "error");
  }
}

elements.createForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (isBusy) return;
  setBusy(true);
  try {
    const character = await db.createCharacter({
      name: elements.name.value,
      classId: elements.classId.value,
    });
    await db.setSetting("selectedCharacterId", character.characterId);
    await refreshCharacters();
    elements.createForm.reset();
    elements.classId.value = "knight";
    elements.name.focus();
    setStatus(`角色「${character.name}」建立成功，已自動選擇。`, "success");
  } catch (error) {
    setStatus(error?.message || "建立角色失敗。", "error");
  } finally {
    setBusy(false);
  }
});

elements.list.addEventListener("click", handleCardAction);

elements.editForm.addEventListener("submit", async event => {
  event.preventDefault();
  const characterId = elements.editId.value;
  try {
    const updated = await db.updateCharacter(characterId, {
      name: elements.editName.value,
      classId: elements.editClassId.value,
    });
    closeEdit();
    await refreshCharacters();
    setStatus(`角色「${updated.name}」已更新。`, "success");
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
  setStatus(`已選擇「${character.name}」。遊戲地圖及戰鬥尚未接入；角色資料已保存，可以安全離開此頁。`, "success");
});

window.addEventListener("pagehide", () => db.close());

async function initialize() {
  try {
    await db.open();
    await refreshCharacters();
    elements.createButton.disabled = false;
    setStatus("本機角色資料庫已就緒。此頁不會連接原遊戲伺服器。", "success");
    document.documentElement.dataset.ready = "true";
  } catch (error) {
    setStatus(error?.message || "無法開啟本機資料庫。請使用 localhost 或 HTTPS。", "error");
    document.documentElement.dataset.ready = "error";
  }
}

initialize();
