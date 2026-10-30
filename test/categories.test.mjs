/**
 * Проверка категорий и показа картинок на заглушках Foundry/PF1.
 * Запуск: npm test
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const hooks = {};
const settings = {};
const actors = {};

class Roll {
  constructor(data) {
    Object.assign(this, data);
  }

  static fromData(data) {
    return new D20Roll(data);
  }
}

class D20Roll extends Roll {
  get natural() {
    return this.nat;
  }
}

const makeItem = (type, actionType) => ({
  type,
  isPhysical: ["weapon", "equipment", "consumable", "loot", "container"].includes(type),
  actions: { get: (id) => (id === "act" ? { data: { actionType } } : undefined) },
});

const ITEMS = {
  sword: makeItem("weapon", "mwak"),
  bow: makeItem("weapon", "rwak"),
  javelin: makeItem("weapon", "twak"),
  fireball: makeItem("spell", "spellsave"),
  rayOfFrost: makeItem("spell", "rsak"),
  potion: makeItem("consumable", "heal"),
  rope: makeItem("equipment", undefined),
  feat: makeItem("feat", "other"),
};

before(async () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  globalThis.document = dom.window.document;
  globalThis.Hooks = { once: (name, fn) => (hooks[name] = fn), on: (name, fn) => (hooks[name] = fn) };
  globalThis.game = {
    settings: {
      register: (_module, key, options) => (settings[key] = options.default),
      get: (_module, key) => settings[key],
    },
  };
  globalThis.ui = {};
  globalThis.Roll = Roll;
  globalThis.fromUuidSync = (uuid) => actors[uuid];
  globalThis.ChatMessage = { implementation: { getSpeakerActor: (speaker) => actors[speaker?.actor] } };

  actors["Actor.pc"] = { hasPlayerOwner: true, items: { get: (id) => ITEMS[id] } };
  actors["Actor.npc"] = { hasPlayerOwner: false, items: { get: (id) => ITEMS[id] } };

  await import("../scripts/main.mjs");
  hooks.init();
  settings.chance = 100;
});

const PLAYER = { isGM: false };
const GM = { isGM: true };

const card = (type) =>
  `<div class="pf1 chat-card item-card"><header class="card-header type-color type-${type} flexrow">` +
  `<img src="icon.png"></header></div>`;
const plain = "";

let nextId = 0;

/** Создать сообщение и вернуть src всплывшей картинки (или null). */
async function render(message, content, { user = PLAYER, actor = "Actor.pc", id = `msg${nextId++}` } = {}) {
  document.body.innerHTML = "";
  await hooks.createChatMessage({
    id,
    speaker: { actor },
    user,
    rolls: [],
    content,
    visible: true,
    isContentVisible: true,
    ...message,
  });
  return document.querySelector(".pf1-chat-images-popup")?.getAttribute("src") ?? null;
}

const itemMessage = (item, naturals = []) => ({
  flags: {
    pf1: {
      metadata: {
        actor: "Actor.pc",
        item,
        action: "act",
        rolls: { attacks: naturals.map((nat) => ({ attack: { nat } })) },
      },
    },
  },
});

const rollMessage = (subject, nat, options) => ({
  flags: { pf1: { subject } },
  rolls: [new D20Roll({ nat, options })],
});

const img = (category) => `chat-images/${category}.webp`;

test("атаки", async () => {
  assert.equal(await render(itemMessage("sword", [12]), card("weapon")), img("melee"));
  assert.equal(await render(itemMessage("bow", [5]), card("weapon")), img("ranged"));
  assert.equal(await render(itemMessage("javelin", [5]), card("weapon")), img("ranged"));
});

test("заклинания", async () => {
  assert.equal(await render(itemMessage("fireball"), card("spell")), img("spell"));
  assert.equal(await render(itemMessage("rayOfFrost", [9]), card("spell")), img("spell"));
});

test("применение предметов", async () => {
  assert.equal(await render(itemMessage("potion"), card("consumable")), img("itemUse"));
  assert.equal(await render(itemMessage("rope"), card("equipment")), img("itemUse"));
  // Израсходованный предмет: тип берётся из шапки карточки
  assert.equal(await render(itemMessage("gone"), card("consumable")), img("itemUse"));
});

test("черты и прочее не трогаются", async () => {
  assert.equal(await render(itemMessage("feat"), card("feat")), null);
  assert.equal(await render(rollMessage({ core: "init" }, 7), plain), null);
  assert.equal(await render(rollMessage({ ability: "str" }, 7), plain), null);
});

test("навыки", async () => {
  assert.equal(await render(rollMessage({ skill: "kna" }, 10), plain), img("knowledge"));
  assert.equal(await render(rollMessage({ skill: "kpl" }, 10), plain), img("knowledge"));
  assert.equal(await render(rollMessage({ skill: "per" }, 10), plain), img("skill"));
  assert.equal(await render(rollMessage({ skill: "crf.crf1" }, 10), plain), img("skill"));
});

test("спасброски", async () => {
  assert.equal(await render(rollMessage({ save: "will" }, 7), plain), img("saveWill"));
  assert.equal(await render(rollMessage({ save: "fort" }, 7), plain), img("saveFort"));
  assert.equal(await render(rollMessage({ save: "ref" }, 7), plain), img("saveRef"));
});

test("криты", async () => {
  assert.equal(await render(itemMessage("sword", [20]), card("weapon")), img("critSuccess"));
  assert.equal(await render(itemMessage("bow", [1]), card("weapon")), img("critFailure"));
  assert.equal(await render(itemMessage("sword", [1, 20]), card("weapon")), img("critSuccess"));
  assert.equal(await render(rollMessage({ save: "ref" }, 20), plain), img("critSuccess"));
  assert.equal(await render(rollMessage({ skill: "per" }, 1), plain), img("critFailure"));
  // «Взять 20» критом не считается
  assert.equal(await render(rollMessage({ skill: "per" }, 20, { staticRoll: 20 }), plain), img("skill"));
});

test("крит можно отключить", async () => {
  settings.critOverride = false;
  try {
    assert.equal(await render(itemMessage("sword", [20]), card("weapon")), img("melee"));
  } finally {
    settings.critOverride = true;
  }
});

test("чьи сообщения меняются", async () => {
  const msg = itemMessage("sword", [12]);
  assert.equal(await render(msg, card("weapon"), { user: GM }), null);

  settings.audience = "playerActors";
  try {
    assert.equal(await render(msg, card("weapon"), { user: GM }), img("melee"));
    assert.equal(await render(msg, card("weapon"), { user: GM, actor: "Actor.npc" }), null);
  } finally {
    settings.audience = "players";
  }

  settings.audience = "all";
  try {
    assert.equal(await render(msg, card("weapon"), { user: GM, actor: "Actor.npc" }), img("melee"));
  } finally {
    settings.audience = "players";
  }
});

test("пустой путь: картинка не показывается", async () => {
  settings["img.melee"] = "";
  try {
    assert.equal(await render(itemMessage("sword", [12]), card("weapon")), null);
  } finally {
    settings["img.melee"] = img("melee");
  }
});

test("шанс показа", async () => {
  settings.chance = 50;
  try {
    const shown = [];
    for (let i = 0; i < 200; i++) {
      shown.push(await render(rollMessage({ save: "will" }, 7), plain, { id: `chance${i}` }));
    }
    const count = shown.filter(Boolean).length;
    assert.ok(count > 60 && count < 140, `показано ${count} из 200`);

    // Результат одинаков для одного и того же сообщения (у всех участников)
    const again = await render(rollMessage({ save: "will" }, 7), plain, { id: "chance7" });
    assert.equal(again, shown[7]);

    settings.chance = 0;
    assert.equal(await render(rollMessage({ save: "will" }, 7), plain), null);
    // Криты по умолчанию показываются всегда
    assert.equal(await render(rollMessage({ save: "will" }, 20), plain), img("critSuccess"));
    settings.critAlways = false;
    assert.equal(await render(rollMessage({ save: "will" }, 20), plain), null);
  } finally {
    settings.chance = 100;
    settings.critAlways = true;
  }
});

test("скрытые броски не раскрываются", async () => {
  assert.equal(await render({ ...rollMessage({ save: "will" }, 7), visible: false }, plain), null);
  assert.equal(await render({ ...rollMessage({ save: "will" }, 7), isContentVisible: false }, plain), null);
});

test("можно выключить только у себя", async () => {
  settings.showForMe = false;
  try {
    assert.equal(await render(rollMessage({ save: "will" }, 7), plain), null);
  } finally {
    settings.showForMe = true;
  }
});

test("новая картинка заменяет предыдущую", async () => {
  await hooks.createChatMessage({
    id: "a", speaker: { actor: "Actor.pc" }, user: PLAYER, content: "", visible: true, isContentVisible: true,
    ...rollMessage({ save: "will" }, 7),
  });
  await hooks.createChatMessage({
    id: "b", speaker: { actor: "Actor.pc" }, user: PLAYER, content: "", visible: true, isContentVisible: true,
    ...rollMessage({ save: "ref" }, 7),
  });
  const popups = document.querySelectorAll(".pf1-chat-images-popup");
  assert.equal(popups.length, 1);
  assert.equal(popups[0].getAttribute("src"), img("saveRef"));
});
