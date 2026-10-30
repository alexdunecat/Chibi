/**
 * PF1 Chat Images
 *
 * Подменяет картинку в сообщениях чата (Foundry VTT v11, Pathfinder 1e 10.x)
 * на заранее подготовленную картинку по категории действия.
 * Сами сообщения не изменяются: подмена делается при отрисовке на каждом клиенте.
 */

const MODULE_ID = "pf1-chat-images";

/** Категории в порядке, в котором они показываются в настройках. */
const CATEGORIES = [
  "spell",
  "melee",
  "ranged",
  "critSuccess",
  "critFailure",
  "knowledge",
  "skill",
  "saveWill",
  "saveFort",
  "saveRef",
  "itemUse",
];

/** Папка в Data, где по умолчанию ищутся картинки. */
const DEFAULT_FOLDER = "chat-images";

const MELEE_ACTIONS = ["mwak", "msak", "mcman"];
const RANGED_ACTIONS = ["rwak", "twak", "rsak", "rcman"];
const PHYSICAL_ITEM_TYPES = ["weapon", "equipment", "consumable", "loot", "container"];
const SAVES = { will: "saveWill", fort: "saveFort", ref: "saveRef" };

const setting = (key) => game.settings.get(MODULE_ID, key);

/* -------------------------------------------- */
/*  Настройки                                   */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "enabled", {
    name: `${MODULE_ID}.Settings.Enabled.Name`,
    hint: `${MODULE_ID}.Settings.Enabled.Hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: rerenderChat,
  });

  game.settings.register(MODULE_ID, "audience", {
    name: `${MODULE_ID}.Settings.Audience.Name`,
    hint: `${MODULE_ID}.Settings.Audience.Hint`,
    scope: "world",
    config: true,
    type: String,
    choices: {
      players: `${MODULE_ID}.Settings.Audience.Players`,
      playerActors: `${MODULE_ID}.Settings.Audience.PlayerActors`,
      all: `${MODULE_ID}.Settings.Audience.All`,
    },
    default: "players",
    onChange: rerenderChat,
  });

  game.settings.register(MODULE_ID, "critOverride", {
    name: `${MODULE_ID}.Settings.CritOverride.Name`,
    hint: `${MODULE_ID}.Settings.CritOverride.Hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: rerenderChat,
  });

  game.settings.register(MODULE_ID, "size", {
    name: `${MODULE_ID}.Settings.Size.Name`,
    hint: `${MODULE_ID}.Settings.Size.Hint`,
    scope: "world",
    config: true,
    type: Number,
    range: { min: 24, max: 256, step: 4 },
    default: 48,
    onChange: rerenderChat,
  });

  for (const category of CATEGORIES) {
    game.settings.register(MODULE_ID, `img.${category}`, {
      name: `${MODULE_ID}.Category.${category}`,
      hint: `${MODULE_ID}.Settings.ImageHint`,
      scope: "world",
      config: true,
      type: String,
      filePicker: "image",
      default: `${DEFAULT_FOLDER}/${category}.webp`,
      onChange: rerenderChat,
    });
  }
});

/** Перерисовать уже показанные сообщения после смены настроек. */
function rerenderChat() {
  ui.chat?.render(true);
}

/* -------------------------------------------- */
/*  Отрисовка сообщений                         */
/* -------------------------------------------- */

Hooks.on("renderChatMessage", (message, html) => {
  try {
    if (!setting("enabled")) return;
    if (!appliesTo(message)) return;

    const category = getCategory(message, html[0] ?? html);
    if (!category) return;

    const src = setting(`img.${category}`)?.trim();
    if (!src) return;

    applyImage(html[0] ?? html, src, category);
  } catch (err) {
    console.error(`${MODULE_ID} | Ошибка при обработке сообщения ${message.id}`, err);
  }
});

/**
 * Проверка, чьи сообщения обрабатываются.
 *
 * @param {ChatMessage} message
 * @returns {boolean}
 */
function appliesTo(message) {
  const audience = setting("audience");
  if (audience === "all") return true;

  const author = message.user ?? message.author;
  if (audience === "players") return !!author && !author.isGM;

  // playerActors: говорящий персонаж принадлежит игроку (даже если бросал ГМ)
  const actor = ChatMessage.implementation.getSpeakerActor(message.speaker);
  return !!actor?.hasPlayerOwner;
}

/* -------------------------------------------- */
/*  Определение категории                       */
/* -------------------------------------------- */

/**
 * @param {ChatMessage} message
 * @param {HTMLElement} element
 * @returns {string|null} Ключ категории из CATEGORIES или null, если сообщение не трогаем.
 */
function getCategory(message, element) {
  const flags = message.flags?.pf1 ?? {};

  // 1. Броски d20 актёра: навыки, спасброски
  if (flags.subject && typeof flags.subject === "object") {
    const base = subjectCategory(flags.subject);
    if (!base) return null;
    return critCategory(message.rolls ?? []) ?? base;
  }

  // 2. Карточки предметов и действий (атаки, заклинания, предметы)
  if (flags.metadata?.item) {
    const base = itemCategory(message, flags.metadata, element);
    if (!base) return null;
    const attackRolls = (flags.metadata.rolls?.attacks ?? []).map((a) => a?.attack).filter(Boolean);
    return critCategory(attackRolls) ?? base;
  }

  return null;
}

/**
 * Категория для бросков с flags.pf1.subject.
 *
 * @param {object} subject
 * @returns {string|null}
 */
function subjectCategory(subject) {
  if (subject.save) return SAVES[subject.save] ?? null;

  if (subject.skill) {
    // Знания: kar, kdu, ken, kge, khi, klo, kna, kno, kpl, kre (и их подпункты)
    const baseSkill = String(subject.skill).split(".")[0];
    return /^k[a-z]{2}$/.test(baseSkill) ? "knowledge" : "skill";
  }

  // Инициатива, БМА, ур. заклинателя, концентрация, характеристики и т.п. не трогаем
  return null;
}

/**
 * Категория для карточки предмета или действия.
 *
 * @param {ChatMessage} message
 * @param {object} metadata flags.pf1.metadata
 * @param {HTMLElement} element
 * @returns {string|null}
 */
function itemCategory(message, metadata, element) {
  const item = findItem(message, metadata);
  const itemType = item?.type ?? itemTypeFromDom(element);

  if (itemType === "spell") return "spell";

  const action = metadata.action ? item?.actions?.get(metadata.action) : null;
  const actionType = action?.data?.actionType ?? action?.actionType;
  if (MELEE_ACTIONS.includes(actionType)) return "melee";
  if (RANGED_ACTIONS.includes(actionType)) return "ranged";

  // Атака, но предмет уже удалён (например, брошенный и израсходованный)
  if (!actionType && metadata.rolls?.attacks?.length) return null;

  const isPhysical = item?.isPhysical ?? PHYSICAL_ITEM_TYPES.includes(itemType);
  if (isPhysical) return "itemUse";

  return null;
}

/**
 * Находит предмет по метаданным сообщения.
 *
 * @param {ChatMessage} message
 * @param {object} metadata
 * @returns {Item|null}
 */
function findItem(message, metadata) {
  let actor = null;
  if (metadata.actor) {
    try {
      actor = fromUuidSync(metadata.actor);
    } catch (err) {
      actor = null;
    }
  }
  actor ??= ChatMessage.implementation.getSpeakerActor(message.speaker);
  return actor?.items?.get(metadata.item) ?? null;
}

/**
 * Тип предмета из класса шапки карточки PF1 (`card-header type-<тип>`).
 * Нужен, если предмет уже удалён (выпитое зелье и т.п.).
 *
 * @param {HTMLElement} element
 * @returns {string|undefined}
 */
function itemTypeFromDom(element) {
  const header = element.querySelector(".pf1.chat-card .card-header");
  if (!header) return undefined;
  const cls = [...header.classList].find((c) => c.startsWith("type-") && c !== "type-color");
  return cls?.slice(5);
}

/**
 * Если среди бросков d20 есть естественная 20 или 1, возвращает категорию крита.
 *
 * @param {Array<Roll|object>} rolls Броски или их JSON
 * @returns {"critSuccess"|"critFailure"|null}
 */
function critCategory(rolls) {
  if (!setting("critOverride")) return null;

  let nat20 = false;
  let nat1 = false;
  for (const raw of rolls) {
    const natural = naturalD20(raw);
    if (natural === 20) nat20 = true;
    else if (natural === 1) nat1 = true;
  }

  if (nat20) return "critSuccess";
  if (nat1) return "critFailure";
  return null;
}

/**
 * Значение на кубике d20 (без модификаторов). Для «Взять 10/20» возвращает undefined.
 *
 * @param {Roll|object} raw
 * @returns {number|undefined}
 */
function naturalD20(raw) {
  let roll = raw;
  if (!(roll instanceof Roll)) {
    try {
      roll = Roll.fromData(raw);
    } catch (err) {
      return undefined;
    }
  }

  if (roll.options?.staticRoll != null) return undefined;
  if ("natural" in roll) return roll.natural;

  const d20 = roll.dice?.find((d) => d.faces === 20);
  const result = d20?.results?.find((r) => r.active);
  return result?.result;
}

/* -------------------------------------------- */
/*  Подмена картинки                            */
/* -------------------------------------------- */

/**
 * @param {HTMLElement} element Корень сообщения
 * @param {string} src Путь к картинке
 * @param {string} category
 */
function applyImage(element, src, category) {
  const size = Number(setting("size")) || 48;

  const existing = element.querySelector(".pf1.chat-card .card-header img");
  if (existing) {
    const original = existing.getAttribute("src");
    const originalStyle = existing.getAttribute("style");
    existing.addEventListener("error", () => restore(existing, original, originalStyle), { once: true });
    existing.src = src;
    existing.classList.add("pf1-chat-images-replaced");
    existing.dataset.pf1ChatImagesCategory = category;
    setSize(existing, size);
    return;
  }

  // В бросках навыков и спасбросков своей картинки нет: вставляем сверху
  const content = element.querySelector(".message-content");
  if (!content || content.querySelector(".pf1-chat-images-banner")) return;

  const banner = document.createElement("div");
  banner.classList.add("pf1-chat-images-banner");
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.dataset.pf1ChatImagesCategory = category;
  setSize(img, size);
  img.addEventListener("error", () => banner.remove(), { once: true });
  banner.append(img);
  content.prepend(banner);
}

function setSize(img, size) {
  img.width = size;
  img.height = size;
  img.style.width = `${size}px`;
  img.style.height = `${size}px`;
  img.style.flex = `0 0 ${size}px`;
}

/** Если подготовленной картинки нет, возвращает исходную. */
function restore(img, original, originalStyle) {
  img.classList.remove("pf1-chat-images-replaced");
  img.width = 36;
  img.height = 36;
  if (originalStyle) img.setAttribute("style", originalStyle);
  else img.removeAttribute("style");
  if (original) img.src = original;
  console.warn(`${MODULE_ID} | Картинка не найдена для категории «${img.dataset.pf1ChatImagesCategory}»`);
}
