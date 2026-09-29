import { test } from "node:test";
import assert from "node:assert/strict";
import Action from "../src/Action.js";
import ActionParameter from "../src/ActionParameter.js";
import ActionOutput from "../src/ActionOutput.js";
import Event from "../src/Event.js";
import EventPayloadVariable from "../src/EventPayloadVariable.js";
import EventParameter from "../src/EventParameter.js";
import Subdevice from "../src/Subdevice.js";

// ── Action ────────────────────────────────────────────────────────────────

test("Action: setTranslations / addTranslation round-trip through export()", () => {
  const action = new Action("toggleLight")
    .setName("Toggle light")
    .setDescription("Turns the light on or off")
    .addParameter(new ActionParameter("on").setName("On").setType("boolean"))
    .addOutput(new ActionOutput("ok").setName("Result").setType("boolean"));

  action.setDefaultLocale("en");
  action.setTranslations({
    es: {
      name: "Encender/apagar luz",
      description: "Enciende o apaga la luz",
      parameters: { on: { name: "Encendido" } },
      outputs: { ok: { name: "Resultado" } },
    },
  });
  action.addTranslation("pt-BR", { name: "Ligar/desligar luz" });

  const exported = action.export();
  assert.equal(exported.defaultLocale, "en");
  assert.equal(exported.i18n.es.name, "Encender/apagar luz");
  assert.equal(exported.i18n.es.parameters.on.name, "Encendido");
  assert.equal(exported.i18n["pt-BR"].name, "Ligar/desligar luz");
  // addTranslation must not clobber the other locale
  assert.equal(exported.i18n.es.name, "Encender/apagar luz");
});

test("Action: export() omits i18n/defaultLocale when never set (backward compatible)", () => {
  const action = new Action("a").setName("A");
  const exported = action.export();
  assert.equal("i18n" in exported, false);
  assert.equal("defaultLocale" in exported, false);
});

test("Action: setTranslations rejects an unknown parameter id", () => {
  const action = new Action("a").setName("A").addParameter(new ActionParameter("x").setName("X").setType("string"));
  assert.throws(() => action.setTranslations({ es: { parameters: { bogus: { name: "y" } } } }));
});

test("Action: setTranslations rejects an invalid locale tag", () => {
  const action = new Action("a").setName("A");
  assert.throws(() => action.setTranslations({ "not a locale": { name: "y" } }));
});

test("Action: setDefaultLocale rejects an invalid tag", () => {
  const action = new Action("a").setName("A");
  assert.throws(() => action.setDefaultLocale("english"));
});

// ── Event ─────────────────────────────────────────────────────────────────

test("Event: setTranslations covers payload/parameters/enumValues", () => {
  const event = new Event("userJoined")
    .setName("User joined")
    .setPayloadVariables([new EventPayloadVariable("userId").setName("User id").setType("string")])
    .setParameters([
      new EventParameter("role").setName("Role").setType("enum").setEnumValues(["mod", "sub"]),
    ]);

  event.setTranslations({
    es: {
      name: "Usuario se unió",
      payload: { userId: { name: "Id de usuario" } },
      parameters: { role: { name: "Rol" } },
      enumValues: { role: { mod: "Moderador", sub: "Suscriptor" } },
    },
  });

  const exported = event.export();
  assert.equal(exported.i18n.es.payload.userId.name, "Id de usuario");
  assert.equal(exported.i18n.es.enumValues.role.mod, "Moderador");
});

test("Event: setTranslations rejects unknown payload field id", () => {
  const event = new Event("e").setName("E");
  assert.throws(() => event.setTranslations({ es: { payload: { bogus: { name: "x" } } } }));
});

// ── Subdevice ────────────────────────────────────────────────────────────

test("Subdevice: setTranslations only allows name/description", () => {
  const sd = new Subdevice({ externalId: "kitchen.lamp", name: "Kitchen lamp" });
  sd.setDefaultLocale("en");
  sd.setTranslations({ es: { name: "Lámpara de cocina" } });
  const exported = sd.export();
  assert.equal(exported.defaultLocale, "en");
  assert.equal(exported.i18n.es.name, "Lámpara de cocina");
});

test("Subdevice: setTranslations rejects a parameters group", () => {
  const sd = new Subdevice({ externalId: "kitchen.lamp", name: "Kitchen lamp" });
  assert.throws(() => sd.setTranslations({ es: { parameters: { x: { name: "y" } } } }));
});

test("Subdevice: setUnauthorized accepts a translated statusMessage map", () => {
  const sd = new Subdevice({ externalId: "kitchen.lamp", name: "Kitchen lamp" });
  sd.setUnauthorized(true, { message: { en: "Token expired", es: "Token caducado" }, sync: false });
  assert.equal(sd.statusMessage.en, "Token expired");
  const exported = sd.export();
  assert.equal(exported.statusMessage.es, "Token caducado");
});
