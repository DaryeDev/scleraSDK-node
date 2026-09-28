import { test } from "node:test";
import assert from "node:assert/strict";
import Action from "../src/Action.js";
import { ANNOTATION_DEFAULTS, resolveAnnotations } from "../src/annotations.js";

// ── Action.annotations ──────────────────────────────────────────────────

test("Action: annotations is undefined when never set", () => {
  const action = new Action("a").setName("A");
  assert.equal(action.annotations, undefined);
  assert.deepEqual(action.export(), { id: "a", name: "A" });
});

test("Action: setAnnotations stores only the declared keys, exported as-is", () => {
  const action = new Action("a").setName("A").setAnnotations({ readOnly: true });
  assert.deepEqual(action.annotations, { readOnly: true });
  assert.deepEqual(action.export().annotations, { readOnly: true });
});

test("Action: setAnnotations accepts all three keys", () => {
  const action = new Action("a")
    .setName("A")
    .setAnnotations({ readOnly: true, destructive: false, idempotent: true });
  assert.deepEqual(action.annotations, { readOnly: true, destructive: false, idempotent: true });
});

test("Action: constructor accepts annotations option", () => {
  const action = new Action({ id: "a", name: "A", annotations: { destructive: false } });
  assert.deepEqual(action.annotations, { destructive: false });
});

test("Action: setAnnotations rejects unknown keys", () => {
  const action = new Action("a").setName("A");
  assert.throws(() => action.setAnnotations({ costly: true }), /unknown annotation "costly"/);
});

test("Action: setAnnotations rejects non-boolean values", () => {
  const action = new Action("a").setName("A");
  assert.throws(() => action.setAnnotations({ readOnly: "yes" }), /must be a boolean/);
});

test("Action: setAnnotations rejects non-object input", () => {
  const action = new Action("a").setName("A");
  assert.throws(() => action.setAnnotations("readOnly"), /must be an object/);
  assert.throws(() => action.setAnnotations(["readOnly"]), /must be an object/);
});

test("Action: setAnnotations(undefined) clears previously-set annotations", () => {
  const action = new Action("a").setName("A").setAnnotations({ readOnly: true });
  action.setAnnotations(undefined);
  assert.equal(action.annotations, undefined);
  assert.equal(action.export().annotations, undefined);
});

test("Action: effectiveAnnotations applies conservative defaults for missing keys", () => {
  const action = new Action("a").setName("A");
  assert.deepEqual(action.effectiveAnnotations, ANNOTATION_DEFAULTS);

  action.setAnnotations({ readOnly: true, idempotent: true });
  assert.deepEqual(action.effectiveAnnotations, {
    readOnly: true,
    destructive: true, // not declared -> conservative default
    idempotent: true,
  });
});

// ── resolveAnnotations / ANNOTATION_DEFAULTS ────────────────────────────

test("ANNOTATION_DEFAULTS is the conservative case", () => {
  assert.deepEqual(ANNOTATION_DEFAULTS, {
    readOnly: false,
    destructive: true,
    idempotent: false,
  });
});

test("resolveAnnotations(undefined) returns the defaults", () => {
  assert.deepEqual(resolveAnnotations(undefined), ANNOTATION_DEFAULTS);
});

test("resolveAnnotations merges partial annotations over the defaults", () => {
  assert.deepEqual(resolveAnnotations({ readOnly: true }), {
    readOnly: true,
    destructive: true,
    idempotent: false,
  });
});
