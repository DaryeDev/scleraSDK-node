import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXECUTE_ON,
  ON_UNAVAILABLE,
  isSpecialExecuteOn,
  isConnectionIdTarget,
  validateExecuteOn,
  validateOnUnavailable,
  buildActionRef,
  parseActionRef,
  resolveNodeExecTarget,
} from "../src/execTarget.js";

test("isSpecialExecuteOn / isConnectionIdTarget distinguish strategies from literal ids", () => {
  assert.equal(isSpecialExecuteOn("random"), true);
  assert.equal(isSpecialExecuteOn("all"), true);
  assert.equal(isSpecialExecuteOn("none"), true);
  assert.equal(isSpecialExecuteOn("hubA:obs@page1"), false);
  assert.equal(isSpecialExecuteOn(""), false);
  assert.equal(isSpecialExecuteOn(undefined), false);

  assert.equal(isConnectionIdTarget("hubA:obs@page1"), true);
  assert.equal(isConnectionIdTarget("random"), false);
  assert.equal(isConnectionIdTarget(""), false);
  assert.equal(isConnectionIdTarget(undefined), false);
});

test("validateExecuteOn: non-empty string ok, anything else rejected", () => {
  assert.equal(validateExecuteOn("random").valid, true);
  assert.equal(validateExecuteOn("hubA:obs@page1").valid, true);
  assert.equal(validateExecuteOn("").valid, false);
  assert.equal(validateExecuteOn(undefined).valid, false);
  assert.equal(validateExecuteOn(42).valid, false);
});

test("validateOnUnavailable: only skip/error accepted", () => {
  assert.equal(validateOnUnavailable("skip").valid, true);
  assert.equal(validateOnUnavailable("error").valid, true);
  assert.equal(validateOnUnavailable("ignore").valid, false);
  assert.equal(validateOnUnavailable(undefined).valid, false);
});

test("buildActionRef: joins actionId and a literal connectionId", () => {
  assert.equal(buildActionRef("setScene", "hubA:obs@page1"), "setScene@hubA:obs@page1");
});

test("buildActionRef: throws for strategy values (server-resolved, not a single ref)", () => {
  assert.throws(() => buildActionRef("setScene", "random"));
  assert.throws(() => buildActionRef("setScene", "all"));
  assert.throws(() => buildActionRef("setScene", "none"));
  assert.throws(() => buildActionRef("setScene", ""));
});

test("parseActionRef: splits actionName@connectionId", () => {
  assert.deepEqual(parseActionRef("setScene@hubA:obs@page1"), {
    actionId: "setScene",
    connectionId: "hubA:obs@page1",
  });
});

test("parseActionRef: bare actionName has null connectionId (caller's own connection)", () => {
  assert.deepEqual(parseActionRef("setScene"), { actionId: "setScene", connectionId: null });
});

test("resolveNodeExecTarget: node value wins over everything", () => {
  const result = resolveNodeExecTarget(
    { executeOn: "all", executeOnFallback: "hubB", onUnavailable: "error" },
    { executeOn: "random", executeOnFallback: "none", onUnavailable: "skip" },
  );
  assert.deepEqual(result, { executeOn: "all", executeOnFallback: "hubB", onUnavailable: "error" });
});

test("resolveNodeExecTarget: legacy connectionId is used as executeOn when executeOn is absent", () => {
  const result = resolveNodeExecTarget({ connectionId: "hubA:obs@page1" }, {});
  assert.equal(result.executeOn, "hubA:obs@page1");
});

test("resolveNodeExecTarget: falls back to flow defaults, then Poisonete defaults", () => {
  assert.deepEqual(resolveNodeExecTarget({}, { executeOn: "all" }), {
    executeOn: "all",
    executeOnFallback: EXECUTE_ON.NONE,
    onUnavailable: ON_UNAVAILABLE.SKIP,
  });
  assert.deepEqual(resolveNodeExecTarget({}, {}), {
    executeOn: EXECUTE_ON.RANDOM,
    executeOnFallback: EXECUTE_ON.NONE,
    onUnavailable: ON_UNAVAILABLE.SKIP,
  });
});
