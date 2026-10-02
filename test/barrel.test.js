import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Action,
  ANNOTATION_DEFAULTS,
  ANNOTATION_KEYS,
  resolveAnnotations,
  VISIBLE_WHEN_OPERATORS,
  VISIBLE_WHEN_VALUE_OPERATORS,
  VISIBLE_WHEN_STRUCTURAL_OPERATORS,
  assertValidVisibleWhenCondition,
  collectVisibleWhenParamRefs,
  assertValidVisibleWhenReferences,
  EXECUTE_ON,
} from "../src/index.js";

test("package barrel: re-exports Action, annotations, visibleWhen, and execTarget once", () => {
  assert.equal(typeof Action, "function");
  assert.ok(ANNOTATION_DEFAULTS);
  assert.ok(Array.isArray(ANNOTATION_KEYS));
  assert.equal(typeof resolveAnnotations, "function");
  assert.ok(Array.isArray(VISIBLE_WHEN_OPERATORS));
  assert.ok(Array.isArray(VISIBLE_WHEN_VALUE_OPERATORS));
  assert.ok(Array.isArray(VISIBLE_WHEN_STRUCTURAL_OPERATORS));
  assert.equal(typeof assertValidVisibleWhenCondition, "function");
  assert.equal(typeof collectVisibleWhenParamRefs, "function");
  assert.equal(typeof assertValidVisibleWhenReferences, "function");
  assert.ok(EXECUTE_ON);
});
