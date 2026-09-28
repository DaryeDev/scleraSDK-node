import { test } from "node:test";
import assert from "node:assert/strict";
import Action from "../src/Action.js";
import ActionParameter from "../src/ActionParameter.js";
import {
  VISIBLE_WHEN_OPERATORS,
  assertValidVisibleWhenCondition,
  collectVisibleWhenParamRefs,
  assertValidVisibleWhenReferences,
} from "../src/visibleWhen.js";

// ── ActionParameter.setVisibleWhen / export() ───────────────────────────────

test("ActionParameter: setVisibleWhen round-trips through export()", () => {
  const p = new ActionParameter("replyTo")
    .setName("Reply to")
    .setType("string")
    .setVisibleWhen({ param: "isReply", op: "truthy" });

  assert.deepEqual(p.visibleWhen, { param: "isReply", op: "truthy" });
  assert.deepEqual(p.export().visibleWhen, { param: "isReply", op: "truthy" });
});

test("ActionParameter: export() omits visibleWhen when never set", () => {
  const p = new ActionParameter("x").setName("X").setType("string");
  assert.equal("visibleWhen" in p.export(), false);
});

test("ActionParameter: setVisibleWhen accepts combinators (all/any/not)", () => {
  const combos = [
    { all: [{ param: "a", op: "truthy" }, { param: "b", op: "eq", value: 1 }] },
    { any: [{ param: "a", op: "truthy" }, { param: "b", op: "eq", value: 1 }] },
    { not: { param: "a", op: "truthy" } },
  ];
  for (const c of combos) {
    const p = new ActionParameter("x").setName("X").setVisibleWhen(c);
    assert.deepEqual(p.export().visibleWhen, c);
  }
});

test("ActionParameter: setVisibleWhen rejects a non-object condition", () => {
  const p = new ActionParameter("x").setName("X");
  assert.throws(() => p.setVisibleWhen("nope"), /must be an object/);
  assert.throws(() => p.setVisibleWhen(null), /must be an object/);
  assert.throws(() => p.setVisibleWhen([{ param: "a", op: "truthy" }]), /must be an object/);
});

test("ActionParameter: setVisibleWhen rejects unknown operators", () => {
  const p = new ActionParameter("x").setName("X");
  assert.throws(
    () => p.setVisibleWhen({ param: "a", op: "startsWith", value: "x" }),
    /op must be one of/,
  );
});

test("ActionParameter: setVisibleWhen rejects missing/empty param", () => {
  const p = new ActionParameter("x").setName("X");
  assert.throws(() => p.setVisibleWhen({ op: "truthy" }), /param must be a non-empty string/);
  assert.throws(() => p.setVisibleWhen({ param: "", op: "truthy" }), /param must be a non-empty string/);
});

test("ActionParameter: setVisibleWhen rejects value on unary operators", () => {
  const p = new ActionParameter("x").setName("X");
  for (const op of ["truthy", "connected", "notConnected"]) {
    assert.throws(
      () => p.setVisibleWhen({ param: "a", op, value: true }),
      new RegExp(`value is not allowed with op "${op}"`),
    );
  }
});

test("ActionParameter: setVisibleWhen requires value for value-comparison operators", () => {
  const p = new ActionParameter("x").setName("X");
  for (const op of ["eq", "neq", "gt", "gte", "lt", "lte"]) {
    assert.throws(
      () => p.setVisibleWhen({ param: "a", op }),
      new RegExp(`value is required for op "${op}"`),
    );
  }
});

test("ActionParameter: setVisibleWhen requires a non-empty array value for in/nin", () => {
  const p = new ActionParameter("x").setName("X");
  assert.throws(() => p.setVisibleWhen({ param: "a", op: "in", value: "x" }), /must be a non-empty array/);
  assert.throws(() => p.setVisibleWhen({ param: "a", op: "in", value: [] }), /must be a non-empty array/);
  p.setVisibleWhen({ param: "a", op: "nin", value: [1, 2] });
  assert.deepEqual(p.export().visibleWhen, { param: "a", op: "nin", value: [1, 2] });
});

test("ActionParameter: setVisibleWhen requires a non-empty string value for sourceType", () => {
  const p = new ActionParameter("x").setName("X");
  assert.throws(() => p.setVisibleWhen({ param: "a", op: "sourceType" }), /must be a non-empty string/);
  p.setVisibleWhen({ param: "a", op: "sourceType", value: "string" });
  assert.equal(p.export().visibleWhen.value, "string");
});

test("ActionParameter: setVisibleWhen rejects unexpected keys on a leaf condition", () => {
  const p = new ActionParameter("x").setName("X");
  assert.throws(
    () => p.setVisibleWhen({ param: "a", op: "truthy", extra: 1 }),
    /unexpected key/,
  );
});

test("ActionParameter: setVisibleWhen rejects mixing combinators", () => {
  const p = new ActionParameter("x").setName("X");
  assert.throws(
    () => p.setVisibleWhen({ all: [{ param: "a", op: "truthy" }], any: [{ param: "b", op: "truthy" }] }),
    /only one of all\/any\/not/,
  );
});

test("ActionParameter: setVisibleWhen rejects a combinator with extra keys alongside it", () => {
  const p = new ActionParameter("x").setName("X");
  assert.throws(
    () => p.setVisibleWhen({ all: [{ param: "a", op: "truthy" }], param: "b" }),
    /cannot be combined with other keys/,
  );
});

test("ActionParameter: setVisibleWhen rejects an empty all/any array", () => {
  const p = new ActionParameter("x").setName("X");
  assert.throws(() => p.setVisibleWhen({ all: [] }), /non-empty array of conditions/);
  assert.throws(() => p.setVisibleWhen({ any: [] }), /non-empty array of conditions/);
});

test("ActionParameter: setVisibleWhen accepts every documented operator", () => {
  assert.deepEqual(
    [...VISIBLE_WHEN_OPERATORS].sort(),
    [
      "connected",
      "eq",
      "gt",
      "gte",
      "in",
      "lt",
      "lte",
      "neq",
      "nin",
      "notConnected",
      "sourceType",
      "truthy",
    ].sort(),
  );
});

// ── collectVisibleWhenParamRefs ─────────────────────────────────────────────

test("collectVisibleWhenParamRefs: walks all/any/not and leaf conditions", () => {
  const refs = collectVisibleWhenParamRefs({
    all: [
      { param: "a", op: "truthy" },
      { any: [{ param: "b", op: "eq", value: 1 }, { not: { param: "c", op: "truthy" } }] },
    ],
  });
  assert.deepEqual([...refs].sort(), ["a", "b", "c"]);
});

// ── Action: cross-parameter reference validation ────────────────────────────

test("Action: export() accepts a visibleWhen that references a sibling parameter", () => {
  const action = new Action("sendMessage")
    .setName("Send message")
    .addParameter(new ActionParameter("isReply").setName("Is reply").setType("boolean"))
    .addParameter(
      new ActionParameter("replyTo")
        .setName("Reply to")
        .setType("string")
        .setVisibleWhen({ param: "isReply", op: "truthy" }),
    );

  const exported = action.export();
  assert.deepEqual(exported.parameters[1].visibleWhen, { param: "isReply", op: "truthy" });
});

test("Action: export() rejects a visibleWhen referencing an unknown parameter", () => {
  const action = new Action("sendMessage")
    .setName("Send message")
    .addParameter(
      new ActionParameter("replyTo")
        .setName("Reply to")
        .setType("string")
        .setVisibleWhen({ param: "isReply", op: "truthy" }),
    );

  assert.throws(() => action.export(), /references unknown parameter "isReply"/);
});

test("Action: export() rejects a visibleWhen that references itself", () => {
  const action = new Action("sendMessage")
    .setName("Send message")
    .addParameter(
      new ActionParameter("replyTo")
        .setName("Reply to")
        .setType("string")
        .setVisibleWhen({ param: "replyTo", op: "truthy" }),
    );

  assert.throws(() => action.export(), /cannot reference itself/);
});

test("assertValidVisibleWhenReferences: no-op when nothing declares visibleWhen", () => {
  assert.doesNotThrow(() =>
    assertValidVisibleWhenReferences([{ id: "a" }, { id: "b" }], "Action \"x\""),
  );
});

test("assertValidVisibleWhenCondition: exported for direct use", () => {
  assert.doesNotThrow(() =>
    assertValidVisibleWhenCondition({ param: "a", op: "truthy" }, "test"),
  );
});
