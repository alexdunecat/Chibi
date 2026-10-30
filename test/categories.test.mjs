/**
 * Проверка определения категорий на заглушках Foundry/PF1.
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
});

const PLAYER = { isGM: false };
const GM = { isGM: true };

const card = (type) =>
  `<div class="message-content"><div class="pf1 chat-card">` +
  `<header class="card-header type-color type-${type} flexrow"><img src="orig.png"></header>` +
  `</div></div>`;
const plain = `<div class="message-content"></div>`;

/** Отрисовать сообщение и вернуть src итоговой картинки (или null). */
function render(message, html, { user = PLAYER, actor = "Actor.pc" } = {}) {
  const el = document.createElement("li");
  el.innerHTML = html;
  hooks.renderChatMessage({ id: "msg", speaker: { actor }, user, rolls: [], ...message }, [el]);
  return el.querySelector("img")?.getAttribute("src") ?? null;
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

test("атаки", () => {
  assert.equal(render(itemMessage("sword", [12]), card("weapon")), img("melee"));
  assert.equal(render(itemMessage("bow", [5]), card("weapon")), img("ranged"));
  assert.equal(render(itemMessage("javelin", [5]), card("weapon")), img("ranged"));
});

test("заклинания", () => {
  assert.equal(render(itemMessage("fireball"), card("spell")), img("spell"));
  assert.equal(render(itemMessage("rayOfFrost", [9]), card("spell")), img("spell"));
});

test("применение предметов", () => {
  assert.equal(render(itemMessage("potion"), card("consumable")), img("itemUse"));
  assert.equal(render(itemMessage("rope"), card("equipment")), img("itemUse"));
  // Израсходованный предмет: тип берётся из шапки карточки
  assert.equal(render(itemMessage("gone"), card("consumable")), img("itemUse"));
});

test("черты и прочее не трогаются", () => {
  assert.equal(render(itemMessage("feat"), card("feat")), "orig.png");
  assert.equal(render(rollMessage({ core: "init" }, 7), plain), null);
  assert.equal(render(rollMessage({ ability: "str" }, 7), plain), null);
});

test("навыки", () => {
  assert.equal(render(rollMessage({ skill: "kna" }, 10), plain), img("knowledge"));
  assert.equal(render(rollMessage({ skill: "kpl" }, 10), plain), img("knowledge"));
  assert.equal(render(rollMessage({ skill: "per" }, 10), plain), img("skill"));
  assert.equal(render(rollMessage({ skill: "crf.crf1" }, 10), plain), img("skill"));
});

test("спасброски", () => {
  assert.equal(render(rollMessage({ save: "will" }, 7), plain), img("saveWill"));
  assert.equal(render(rollMessage({ save: "fort" }, 7), plain), img("saveFort"));
  assert.equal(render(rollMessage({ save: "ref" }, 7), plain), img("saveRef"));
});

test("криты", () => {
  assert.equal(render(itemMessage("sword", [20]), card("weapon")), img("critSuccess"));
  assert.equal(render(itemMessage("bow", [1]), card("weapon")), img("critFailure"));
  assert.equal(render(itemMessage("sword", [1, 20]), card("weapon")), img("critSuccess"));
  assert.equal(render(rollMessage({ save: "ref" }, 20), plain), img("critSuccess"));
  assert.equal(render(rollMessage({ skill: "per" }, 1), plain), img("critFailure"));
  // «Взять 20» критом не считается
  assert.equal(render(rollMessage({ skill: "per" }, 20, { staticRoll: 20 }), plain), img("skill"));
});

test("крит можно отключить", () => {
  settings.critOverride = false;
  try {
    assert.equal(render(itemMessage("sword", [20]), card("weapon")), img("melee"));
  } finally {
    settings.critOverride = true;
  }
});

test("чьи сообщения меняются", () => {
  const msg = itemMessage("sword", [12]);
  assert.equal(render(msg, card("weapon"), { user: GM }), "orig.png");

  settings.audience = "playerActors";
  try {
    assert.equal(render(msg, card("weapon"), { user: GM }), img("melee"));
    assert.equal(render(msg, card("weapon"), { user: GM, actor: "Actor.npc" }), "orig.png");
  } finally {
    settings.audience = "players";
  }

  settings.audience = "all";
  try {
    assert.equal(render(msg, card("weapon"), { user: GM, actor: "Actor.npc" }), img("melee"));
  } finally {
    settings.audience = "players";
  }
});

test("пустой путь оставляет исходную картинку", () => {
  settings["img.melee"] = "";
  try {
    assert.equal(render(itemMessage("sword", [12]), card("weapon")), "orig.png");
  } finally {
    settings["img.melee"] = img("melee");
  }
});
