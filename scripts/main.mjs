/**
 * PF1 Chat Images
 *
 * Когда игрок совершает действие (Foundry VTT v11, Pathfinder 1e 10.x), с заданным шансом
 * показывает слева от чата полупрозрачную картинку, подготовленную для категории действия.
 * Сами сообщения не изменяются.
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

/** Сколько ждать окончания анимации Dice So Nice, мс. */
const DICE_WAIT_TIMEOUT = 10000;

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
  });

  game.settings.register(MODULE_ID, "critOverride", {
    name: `${MODULE_ID}.Settings.CritOverride.Name`,
    hint: `${MODULE_ID}.Settings.CritOverride.Hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "chance", {
    name: `${MODULE_ID}.Settings.Chance.Name`,
    hint: `${MODULE_ID}.Settings.Chance.Hint`,
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 100, step: 5 },
    default: 30,
  });

  game.settings.register(MODULE_ID, "critAlways", {
    name: `${MODULE_ID}.Settings.CritAlways.Name`,
    hint: `${MODULE_ID}.Settings.CritAlways.Hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "opacity", {
    name: `${MODULE_ID}.Settings.Opacity.Name`,
    hint: `${MODULE_ID}.Settings.Opacity.Hint`,
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0.1, max: 1, step: 0.05 },
    default: 1,
  });

  game.settings.register(MODULE_ID, "fade", {
    name: `${MODULE_ID}.Settings.Fade.Name`,
    hint: `${MODULE_ID}.Settings.Fade.Hint`,
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 50, step: 5 },
    default: 20,
  });

  game.settings.register(MODULE_ID, "duration", {
    name: `${MODULE_ID}.Settings.Duration.Name`,
    hint: `${MODULE_ID}.Settings.Duration.Hint`,
    scope: "world",
    config: true,
    type: Number,
    range: { min: 1, max: 15, step: 0.5 },
    default: 4,
  });

  game.settings.register(MODULE_ID, "size", {
    name: `${MODULE_ID}.Settings.Size.Name`,
    hint: `${MODULE_ID}.Settings.Size.Hint`,
    scope: "world",
    config: true,
    type: Number,
    range: { min: 100, max: 800, step: 20 },
    default: 320,
  });

  game.settings.register(MODULE_ID, "showForMe", {
    name: `${MODULE_ID}.Settings.ShowForMe.Name`,
    hint: `${MODULE_ID}.Settings.ShowForMe.Hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
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
      });
  }
});

/* -------------------------------------------- */
/*  Новые сообщения                             */
/* -------------------------------------------- */

// Срабатывает у каждого клиента только для новых сообщений, не при перерисовке чата
Hooks.on("createChatMessage", async (message) => {
  try {
    if (!setting("enabled") || !setting("showForMe")) return;
    if (!appliesTo(message)) return;
    // Скрытые и слепые броски не раскрываем
    if (!message.visible || message.isContentVisible === false) return;

    const category = getCategory(message);
    if (!category) return;

    if (!passesChance(message, category)) return;

    const src = setting(`img.${category}`)?.trim();
    if (!src) return;

    await waitForDice(message);
    showImage(src, category);
  } catch (err) {
    console.error(`${MODULE_ID} | Ошибка при обработке сообщения ${message.id}`, err);
  }
});

/**
 * Проверка шанса. Результат зависит от id сообщения, поэтому все участники
 * видят (или не видят) одну и ту же картинку.
 *
 * @param {ChatMessage} message
 * @param {string} category
 * @returns {boolean}
 */
function passesChance(message, category) {
  if (setting("critAlways") && (category === "critSuccess" || category === "critFailure")) return true;
  const chance = Number(setting("chance")) || 0;
  if (chance >= 100) return true;
  if (chance <= 0) return false;
  return hashPercent(message.id) < chance;
}

/**
 * Число от 0 до 99, стабильное для одной строки.
 *
 * @param {string} str
 * @returns {number}
 */
function hashPercent(str) {
  let hash = 2166136261;
  for (const ch of String(str)) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

/**
 * Если включён Dice So Nice, ждёт, пока кубики этого сообщения докатятся,
 * чтобы картинка крита не опережала анимацию.
 *
 * @param {ChatMessage} message
 * @returns {Promise<void>}
 */
function waitForDice(message) {
  if (!game.modules?.get("dice-so-nice")?.active) return Promise.resolve();
  const hasRolls = message.rolls?.length || message.flags?.pf1?.metadata?.rolls?.attacks?.length;
  if (!hasRolls) return Promise.resolve();

  return new Promise((resolve) => {
    const hookId = Hooks.on("diceSoNiceRollComplete", (messageId) => {
      if (messageId !== message.id) return;
      done();
    });
    const timer = setTimeout(done, DICE_WAIT_TIMEOUT);
    function done() {
      clearTimeout(timer);
      Hooks.off("diceSoNiceRollComplete", hookId);
      resolve();
    }
  });
}

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
 * @returns {string|null} Ключ категории из CATEGORIES или null, если сообщение не трогаем.
 */
function getCategory(message) {
  const flags = message.flags?.pf1 ?? {};

  // 1. Броски d20 актёра: навыки, спасброски
  if (flags.subject && typeof flags.subject === "object") {
    const base = subjectCategory(flags.subject);
    if (!base) return null;
    return critCategory(message.rolls ?? []) ?? base;
  }

  // 2. Карточки предметов и действий (атаки, заклинания, предметы)
  if (flags.metadata?.item) {
    const base = itemCategory(message, flags.metadata);
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
 * @returns {string|null}
 */
function itemCategory(message, metadata) {
  const item = findItem(message, metadata);
  const itemType = item?.type ?? itemTypeFromContent(message.content);

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
 * Тип предмета из класса шапки карточки PF1 (`card-header type-color type-<тип>`).
 * Нужен, если предмет уже удалён (выпитое зелье и т.п.).
 *
 * @param {string} content HTML сообщения
 * @returns {string|undefined}
 */
function itemTypeFromContent(content) {
  const header = String(content ?? "").match(/class="card-header[^"]*"/)?.[0] ?? "";
  return header.match(/\btype-(?!color\b)([a-z]+)/)?.[1];
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
/*  Показ картинки                              */
/* -------------------------------------------- */

let hideTimer = null;

/**
 * Показывает картинку слева от боковой панели чата. Новая картинка заменяет предыдущую.
 *
 * @param {string} src Путь к картинке
 * @param {string} category
 */
function showImage(src, category) {
  const size = Number(setting("size")) || 320;
  const opacity = Number(setting("opacity")) || 1;
  const fade = Math.min(50, Math.max(0, Number(setting("fade")) || 0));
  const duration = (Number(setting("duration")) || 4) * 1000;

  document.getElementById(`${MODULE_ID}-popup`)?.remove();
  clearTimeout(hideTimer);

  const img = document.createElement("img");
  img.id = `${MODULE_ID}-popup`;
  img.className = `${MODULE_ID}-popup`;
  img.alt = "";
  img.dataset.category = category;
  img.style.setProperty("--pf1-chat-images-opacity", String(opacity));
  img.style.setProperty("--pf1-chat-images-fade", `${fade}%`);
  img.style.maxWidth = `${size}px`;
  img.style.maxHeight = `${size}px`;
  placeNextToSidebar(img);

  img.addEventListener("error", () => {
    img.remove();
    console.warn(`${MODULE_ID} | Картинка не найдена для категории «${category}»: ${src}`);
  }, { once: true });
  img.addEventListener("load", () => {
    requestAnimationFrame(() => img.classList.add("visible"));
    hideTimer = setTimeout(() => {
      img.classList.remove("visible");
      img.addEventListener("transitionend", () => img.remove(), { once: true });
      // На случай, если переход не сработал (вкладка в фоне и т.п.)
      setTimeout(() => img.remove(), 1500);
    }, duration);
  }, { once: true });

  img.src = src;
  document.body.append(img);
}

/**
 * Ставит картинку у левого края боковой панели, внизу, на уровне чата.
 *
 * @param {HTMLElement} img
 */
function placeNextToSidebar(img) {
  const sidebar = document.getElementById("sidebar");
  const rect = sidebar?.getBoundingClientRect();
  const gap = 12;
  const right = rect && rect.width ? window.innerWidth - rect.left + gap : gap;
  img.style.right = `${right}px`;
  img.style.bottom = `${gap * 2}px`;
}
