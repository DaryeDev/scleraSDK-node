import { test } from "node:test";
import assert from "node:assert/strict";
import Collection from "../src/Collection.js";
import Subdevice from "../src/Subdevice.js";
import Action from "../src/Action.js";
import ActionParameter from "../src/ActionParameter.js";
import Event from "../src/Event.js";
import EventParameter from "../src/EventParameter.js";

test("Collection: set() populates items and bumps version", () => {
  const channels = new Collection("channels", { name: "Canales" });
  assert.equal(channels.version, 0);
  channels.set(
    [
      { id: "111", name: "general", kind: "text" },
      { id: "222", name: "clips", kind: "text" },
    ],
    { sync: false },
  );
  assert.equal(channels.version, 1);
  assert.equal(channels.items.length, 2);
});

test("Collection: upsert adds a new item and bumps version", () => {
  const channels = new Collection("channels");
  channels.set([{ id: "111", name: "general" }], { sync: false });
  channels.upsert({ id: "222", name: "clips" }, { sync: false });
  assert.equal(channels.version, 2);
  assert.deepEqual(
    channels.items.map((i) => i.id),
    ["111", "222"],
  );
});

test("Collection: upsert replaces an existing item in place (order preserved)", () => {
  const channels = new Collection("channels");
  channels.set(
    [
      { id: "111", name: "general" },
      { id: "222", name: "clips" },
    ],
    { sync: false },
  );
  channels.upsert({ id: "111", name: "general-renamed" }, { sync: false });
  assert.deepEqual(
    channels.items.map((i) => i.id),
    ["111", "222"],
  );
  assert.equal(channels.items[0].name, "general-renamed");
});

test("Collection: remove deletes by key or by item, no-op (no version bump) if absent", () => {
  const channels = new Collection("channels");
  channels.set(
    [
      { id: "111", name: "general" },
      { id: "222", name: "clips" },
    ],
    { sync: false },
  );
  const v = channels.version;
  channels.remove("111", { sync: false });
  assert.deepEqual(
    channels.items.map((i) => i.id),
    ["222"],
  );
  assert.equal(channels.version, v + 1);

  const v2 = channels.version;
  channels.remove("does-not-exist", { sync: false });
  assert.equal(channels.version, v2); // no-op: unknown key doesn't bump version

  channels.remove({ id: "222" }, { sync: false });
  assert.equal(channels.items.length, 0);
});

test("Collection: rejects duplicate keys in set()", () => {
  const channels = new Collection("channels");
  assert.throws(() => channels.set([{ id: "1" }, { id: "1" }], { sync: false }));
});

test("Collection: rejects items missing the key field", () => {
  const channels = new Collection("channels");
  assert.throws(() => channels.set([{ name: "no id" }], { sync: false }));
});

test("Collection: custom key field", () => {
  const roles = new Collection("roles", { key: "roleId" });
  roles.set([{ roleId: "9", name: "Mods" }], { sync: false });
  assert.equal(roles.items[0].name, "Mods");
});

test("Collection: enforces the 1000-item soft limit", () => {
  const big = new Collection("big");
  const items = Array.from({ length: 1001 }, (_, i) => ({ id: String(i) }));
  assert.throws(() => big.set(items, { sync: false }), /1000-item/);
});

test("Collection: export() shape matches collection.schema.json", () => {
  const channels = new Collection("channels", {
    name: "Canales",
    itemSchema: { type: "object", properties: { id: { type: "string" } } },
  });
  channels.set([{ id: "111", name: "general" }], { sync: false });
  const exported = channels.export();
  assert.equal(exported.name, "Canales");
  assert.ok(exported.itemSchema);
  assert.equal(exported.version, 1);
  assert.deepEqual(exported.items, [{ id: "111", name: "general" }]);
});

test("Collection: rejects an invalid name", () => {
  assert.throws(() => new Collection("bad name!"));
});

test("Subdevice.addCollection: collection appears in export().collections", () => {
  const channels = new Collection("channels");
  channels.set([{ id: "111", name: "general" }], { sync: false });

  const sd = new Subdevice({ name: "Discord · page1" });
  sd.addCollection(channels, { sync: false });

  const exported = sd.export();
  assert.ok(exported.collections);
  assert.equal(exported.collections.channels.items.length, 1);
  assert.equal(exported.collections.channels.version, 1);
});

test("Subdevice.export(): omits collections entirely when none are published (backward compatible)", () => {
  const sd = new Subdevice({ name: "Lamp" });
  const exported = sd.export();
  assert.equal("collections" in exported, false);
});

test("Subdevice: mutating a bound collection notifies the subdevice's own listeners", () => {
  const channels = new Collection("channels");
  const sd = new Subdevice({ name: "Discord · page1" });
  sd.addCollection(channels, { sync: false });

  let notified = 0;
  sd.onChange(() => {
    notified += 1;
  });
  channels.upsert({ id: "1", name: "general" });
  assert.equal(notified, 1);
});

test("Subdevice.removeCollection", () => {
  const channels = new Collection("channels");
  const sd = new Subdevice({ name: "Discord · page1" });
  sd.addCollection(channels, { sync: false });
  assert.ok(sd.getCollection("channels"));
  sd.removeCollection("channels", { sync: false });
  assert.equal(sd.getCollection("channels"), undefined);
});

test("ActionParameter: optionsFrom alone (no enumValues) satisfies the enum type", () => {
  const p = new ActionParameter({
    id: "channel",
    name: "Channel",
    type: "enum",
    optionsFrom: { collection: "channels", value: "id", label: "name" },
  });
  const exported = p.export();
  assert.deepEqual(exported.optionsFrom, { collection: "channels", value: "id", label: "name" });
  assert.equal(exported.enumValues, undefined);
});

test("ActionParameter: enum without enumValues or optionsFrom throws on export", () => {
  const p = new ActionParameter({ id: "channel", name: "Channel", type: "enum" });
  assert.throws(() => p.export(), /requires enumValues or optionsFrom/);
});

test("ActionParameter: optionsFrom on a non-enum type throws", () => {
  assert.throws(
    () =>
      new ActionParameter({
        id: "x",
        name: "X",
        type: "string",
        optionsFrom: { collection: "c", value: "id", label: "name" },
      }).export(),
    /not of type enum/,
  );
});

test("ActionParameter: enumValues + optionsFrom combine (precedence: fixed values exported first)", () => {
  const p = new ActionParameter({
    id: "channel",
    name: "Channel",
    type: "enum",
    enumValues: [{ key: "Any", value: "*" }],
    optionsFrom: { collection: "channels", value: "id", label: "name" },
  });
  const exported = p.export();
  assert.deepEqual(exported.enumValues, [{ key: "Any", value: "*" }]);
  assert.ok(exported.optionsFrom);
});

test("ActionParameter: optionsFrom carries filter and strict through export", () => {
  const p = new ActionParameter({
    id: "role",
    name: "Role",
    type: "enum",
    optionsFrom: {
      collection: "roles",
      value: "id",
      label: "name",
      filter: [{ field: "channelIds", op: "contains", param: "channel" }],
      strict: false,
    },
  });
  const exported = p.export();
  assert.equal(exported.optionsFrom.strict, false);
  assert.equal(exported.optionsFrom.filter.length, 1);
});

test("Action: end-to-end export includes optionsFrom on its parameters", () => {
  const action = new Action({
    id: "sendToChannel",
    name: "Send to channel",
    parameters: [
      new ActionParameter({
        id: "channel",
        name: "Channel",
        type: "enum",
        optionsFrom: { collection: "channels", value: "id", label: "name" },
      }),
    ],
  });
  const exported = action.export();
  assert.equal(exported.parameters[0].optionsFrom.collection, "channels");
});

test("EventParameter: optionsFrom alone satisfies the enum type, exported under parameterSchema", () => {
  const event = new Event({
    id: "onMessage",
    name: "On message",
    parameters: [
      new EventParameter({
        id: "channel",
        name: "Channel",
        type: "enum",
        optionsFrom: { collection: "channels", value: "id", label: "name" },
      }),
    ],
  });
  const exported = event.export();
  assert.equal(exported.parameterSchema.properties.channel.optionsFrom.collection, "channels");
});

test("EventParameter: enum without enumValues or optionsFrom throws on export", () => {
  const p = new EventParameter({ id: "channel", name: "Channel", type: "enum" });
  assert.throws(() => p.export(), /requires enumValues or optionsFrom/);
});
