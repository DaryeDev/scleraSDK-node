import { test } from "node:test";
import assert from "node:assert/strict";
import Subdevice from "../src/Subdevice.js";

test("Subdevice: connected defaults true, status defaults connected", () => {
  const sd = new Subdevice({ name: "Lamp" });
  assert.equal(sd.connected, true);
  assert.equal(sd.unauthorized, false);
  assert.equal(sd.degraded, false);
  assert.equal(sd.status, "connected");
  assert.equal(sd.statusValue, null);
  assert.equal(sd.statusMessage, null);
});

test("Subdevice: setUnauthorized sets status and message", () => {
  const sd = new Subdevice({ name: "Lamp" });
  sd.setUnauthorized(true, { message: "Token expired", sync: false });
  assert.equal(sd.unauthorized, true);
  assert.equal(sd.status, "unauthorized");
  assert.equal(sd.statusValue, "unauthorized");
  assert.equal(sd.statusMessage, "Token expired");
});

test("Subdevice: setDegraded sets status and message", () => {
  const sd = new Subdevice({ name: "Lamp" });
  sd.setDegraded(true, { message: "Rate limited", sync: false });
  assert.equal(sd.degraded, true);
  assert.equal(sd.status, "degraded");
  assert.equal(sd.statusMessage, "Rate limited");
});

test("Subdevice: unauthorized wins over degraded when both set", () => {
  const sd = new Subdevice({ name: "Lamp" });
  sd.setDegraded(true, { message: "Rate limited", sync: false });
  sd.setUnauthorized(true, { message: "Token expired", sync: false });
  assert.equal(sd.status, "unauthorized");
  assert.equal(sd.statusValue, "unauthorized");
  assert.equal(sd.statusMessage, "Token expired");
  // clearing unauthorized falls back to degraded
  sd.setUnauthorized(false, { sync: false });
  assert.equal(sd.status, "degraded");
  assert.equal(sd.statusMessage, "Rate limited");
});

test("Subdevice: disconnected always wins over unauthorized/degraded", () => {
  const sd = new Subdevice({ name: "Lamp" });
  sd.setUnauthorized(true, { message: "Token expired", sync: false });
  sd.setConnected(false, { sync: false });
  assert.equal(sd.status, "disconnected");
});

test("Subdevice: export() omits status fields when neither is set (backward compatible)", () => {
  const sd = new Subdevice({ name: "Lamp", externalId: "lamp1" });
  const exported = sd.export();
  assert.equal("status" in exported, false);
  assert.equal("statusMessage" in exported, false);
  assert.equal(exported.connected, true);
});

test("Subdevice: export() includes status/statusMessage once set", () => {
  const sd = new Subdevice({ name: "Lamp", externalId: "lamp1" });
  sd.setDegraded(true, { message: "Rate limited", sync: false });
  const exported = sd.export();
  assert.equal(exported.status, "degraded");
  assert.equal(exported.statusMessage, "Rate limited");
});
