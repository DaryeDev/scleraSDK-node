import WebSocket from "ws";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import ResourceHost from "./ResourceHost.js";
import Subdevice from "./Subdevice.js";
import { buildSubdevicePublicId } from "./subdeviceId.js";
import { normalizeRegisterOpts } from "./syncOptions.js";
import { normalizeOptionalColor } from "./color.js";

const SYNC_DEBOUNCE_MS = 50;

export default class ScleraClient extends ResourceHost {
  #url;
  #ws;
  #pendingResponses = new Map();
  #configPath;
  #config = {};
  #eventHandlers = {};
  #heartbeatInterval;

  /** @type {Map<string, Map<string, import('./Action.js').default>>} */
  #subdeviceActions = new Map();

  // Event system state
  #ecdh = null;
  #emitterChannelKeys = new Map();
  #channelKeys = new Map();
  #eventCallbacks = new Map();
  #sessionActive = false;
  #hubClientId = null;
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  #syncTimers = new Map();
  /** @type {string | undefined} */
  #color;
  /** @type {WeakMap<import('./Action.js').default, () => void>} */
  #catalogActionUnsubs = new WeakMap();
  /** @type {WeakMap<import('./Event.js').default, () => void>} */
  #catalogEventUnsubs = new WeakMap();

  /**
   * @param {object} [opts]
   * @param {string} [opts.url]
   * @param {string} [opts.configPath]
   * @param {string} [opts.color]
   * @param {import('./Action.js').default[]} [opts.actions]
   * @param {import('./Event.js').default[]} [opts.events]
   * @param {import('./Subdevice.js').default[]} [opts.subdevices]
   */
  constructor({
    url = "wss://apisclera.darye.dev/ws",
    configPath = "client_config.json",
    color,
    actions = [],
    events = [],
    subdevices = [],
  } = {}) {
    super({ actions, events, subdevices });
    this.#url = url;
    this.#configPath = configPath;
    if (color !== undefined) this.setColor(color);
    if (configPath) this.#loadConfig();
    this.#bindAllCatalogResources();
  }

  addAction(action, opts) {
    super.addAction(action);
    this._bindCatalogAction(action);
    this.scheduleActionSync(opts);
    return this;
  }

  removeAction(actionOrId, opts) {
    const id = typeof actionOrId === "string" ? actionOrId : actionOrId?.id;
    const action = id ? this.getAction(id) : undefined;
    super.removeAction(actionOrId);
    if (action) this._unbindCatalogAction(action);
    this.scheduleActionSync(opts);
    return this;
  }

  addEvent(event, opts) {
    super.addEvent(event);
    this._bindCatalogEvent(event);
    this.scheduleEventSync(opts);
    return this;
  }

  removeEvent(eventOrId, opts) {
    const id = typeof eventOrId === "string" ? eventOrId : eventOrId?.id;
    const event = id ? this.getEvent(id) : undefined;
    super.removeEvent(eventOrId);
    if (event) this._unbindCatalogEvent(event);
    this.scheduleEventSync(opts);
    return this;
  }

  addSubdevice(subdevice, opts) {
    super.addSubdevice(subdevice);
    this._bindSubdevice(subdevice);
    this.scheduleSubdeviceSync(opts);
    return this;
  }

  removeSubdevice(subdeviceOrExternalId, opts) {
    const key =
      typeof subdeviceOrExternalId === "string"
        ? subdeviceOrExternalId
        : subdeviceOrExternalId?.externalId;
    const sd = key ? this.getSubdevice(key) : undefined;
    if (sd) sd._unbindHost();
    super.removeSubdevice(subdeviceOrExternalId);
    this.scheduleSubdeviceSync(opts);
    return this;
  }

  _bindCatalogAction(action) {
    if (this.#catalogActionUnsubs.has(action)) return;
    const unsub = action.onChange((opts) => this.scheduleActionSync(opts));
    this.#catalogActionUnsubs.set(action, unsub);
  }

  _unbindCatalogAction(action) {
    const unsub = this.#catalogActionUnsubs.get(action);
    if (unsub) {
      unsub();
      this.#catalogActionUnsubs.delete(action);
    }
  }

  _bindCatalogEvent(event) {
    if (this.#catalogEventUnsubs.has(event)) return;
    const unsub = event.onChange((opts) => this.scheduleEventSync(opts));
    this.#catalogEventUnsubs.set(event, unsub);
  }

  _unbindCatalogEvent(event) {
    const unsub = this.#catalogEventUnsubs.get(event);
    if (unsub) {
      unsub();
      this.#catalogEventUnsubs.delete(event);
    }
  }

  _bindSubdevice(subdevice) {
    subdevice._bindHost({
      client: this,
      scheduleSubdeviceSync: (o) => this.scheduleSubdeviceSync(o),
      rekeySubdevice: (oldKey, sd) => this._catalog().rekeySubdevice(oldKey, sd),
      getPublicId: () => {
        const parentId = this.#hubClientId ?? this.#config.deviceId;
        return parentId ? buildSubdevicePublicId(parentId, subdevice.externalId) : null;
      },
    });
    subdevice._refreshEventBindings();
  }

  #emitterChannelKey(emitterId, eventId) {
    return emitterId ? `${emitterId}:${eventId}` : eventId;
  }

  async #ensureHubClientId() {
    if (this.#hubClientId) return this.#hubClientId;
    const user = await this.getUser();
    this.#hubClientId = user?.clientId ?? this.#config.deviceId ?? null;
    return this.#hubClientId;
  }

  #prepareSubdeviceEventKeys(subdevices) {
    const parentId = this.#hubClientId;
    if (!parentId) return;
    for (const sd of subdevices) {
      const emitterId = buildSubdevicePublicId(parentId, sd.externalId);
      for (const event of sd.getEventsArray()) {
        const key = this.#emitterChannelKey(emitterId, event.id);
        if (!this.#emitterChannelKeys.has(key)) {
          this.#emitterChannelKeys.set(key, crypto.randomBytes(32));
        }
      }
    }
  }

  rekeySubdevice(oldExternalId, subdevice) {
    this._catalog().rekeySubdevice(oldExternalId, subdevice);
  }

  #bindAllCatalogResources() {
    for (const a of this.getActions()) this._bindCatalogAction(a);
    for (const e of this.getEvents()) this._bindCatalogEvent(e);
    for (const sd of this.getSubdevices()) this._bindSubdevice(sd);
  }

  scheduleActionSync(opts) {
    this.#scheduleResourceSync("actions", opts);
  }

  scheduleEventSync(opts) {
    this.#scheduleResourceSync("events", opts);
  }

  scheduleSubdeviceSync(opts) {
    this.#scheduleResourceSync("subdevices", opts);
  }

  /**
   * @param {string} color  #RRGGBB accent color for this connection in the flow editor.
   */
  setColor(color) {
    this.#color = normalizeOptionalColor(color);
    this.scheduleConnectionProfileSync();
    return this;
  }

  scheduleConnectionProfileSync(opts) {
    this.#scheduleResourceSync("connectionProfile", opts);
  }

  #scheduleResourceSync(resource, opts) {
    const { sync, replace } = normalizeRegisterOpts(opts);
    if (!sync || !this.#sessionActive || this.#ws?.readyState !== 1) return;

    let pending = this.#syncTimers.get(resource);
    if (pending) {
      clearTimeout(pending.timer);
      pending.replace = pending.replace || replace;
    } else {
      pending = { replace };
      this.#syncTimers.set(resource, pending);
    }

    pending.timer = setTimeout(() => {
      this.#syncTimers.delete(resource);
      this.#flushResourceSync(resource, { replace: pending.replace }).catch((err) => {
        this.#emit("syncError", { resource, error: err });
      });
    }, SYNC_DEBOUNCE_MS);
  }

  async #flushResourceSync(resource, { replace }) {
    switch (resource) {
      case "actions":
        await this.registerActions(undefined, { replace, sync: true });
        break;
      case "events":
        await this.registerEvents(undefined, { replace, sync: true });
        break;
      case "subdevices":
        await this.registerSubdevices(undefined, { replace, sync: true });
        break;
      case "connectionProfile":
        await this.registerConnectionProfile({ sync: true });
        break;
      default:
        break;
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.#ecdh = crypto.createECDH("prime256v1");
      this.#ecdh.generateKeys();
      this.#channelKeys.clear();

      this.#ws = new WebSocket(this.#url);

      this.#ws.on("open", () => {
        this.#emit("connected");
        resolve();
      });

      this.#ws.on("message", (raw) => this.#handleMessage(raw));

      this.#ws.on("close", () => {
        clearInterval(this.#heartbeatInterval);
        for (const [, pending] of this.#pendingResponses.entries()) {
          clearTimeout(pending.timer);
          pending.reject(new Error("WebSocket disconnected"));
        }
        this.#pendingResponses.clear();
        this.#sessionActive = false;
        for (const [, pending] of this.#syncTimers.entries()) {
          clearTimeout(pending.timer);
        }
        this.#syncTimers.clear();
        this.#emit("disconnected");
      });

      this.#ws.on("error", (err) => {
        this.#emit("error", err);
        reject(err);
      });
    });
  }

  close() {
    if (this.#ws) {
      clearInterval(this.#heartbeatInterval);
      this.#ws.close();
    }
  }

  async login({ clientSecret, accessToken, clientId } = {}) {
    if (!clientSecret && !accessToken) {
      clientSecret = this.#config.clientSecret;
    }
    if (!clientSecret && !accessToken) {
      throw new Error("login requires clientSecret or accessToken");
    }
    const data = clientId && clientSecret
      ? { clientId, clientSecret }
      : clientSecret
        ? { clientSecret }
        : { accessToken };
    const response = await this.sendAndWaitForResponse("login", data);
    if (response?.loggedIn) {
      this.#sessionActive = true;
      await this.#ensureHubClientId();
      for (const sd of this.getSubdevices()) this._bindSubdevice(sd);
      this.#emit("loggedIn", response);
      await this.#syncRegisteredResources();
      return response;
    }
    throw new Error(response?.message || "Login failed");
  }

  /** Push local action/event/subdevice catalogs to the server after auth (replace=true clears orphans). */
  async #syncRegisteredResources() {
    const actions = this.getActions();
    if (actions.length > 0) {
      await this.registerActions(undefined, { replace: true, sync: true });
    }

    const events = this.getEvents();
    if (events.length > 0) {
      await this.registerEvents(undefined, { replace: true, sync: true });
    }

    const subdevices = this.getSubdevices();
    if (subdevices.length > 0) {
      await this.registerSubdevices(undefined, { replace: true, sync: true });
    }

    if (this.#color !== undefined) {
      await this.registerConnectionProfile({ sync: true });
    }
  }

  /**
   * @param {{ sync?: boolean }} [opts]
   */
  async registerConnectionProfile(opts = {}) {
    const { sync } = normalizeRegisterOpts(opts);
    if (this.#color === undefined) {
      return { ok: true, localOnly: true, color: null };
    }
    if (!sync) return { ok: true, localOnly: true, color: this.#color };
    return await this.sendAndWaitForResponse("connection/setProfile", {
      color: this.#color,
    });
  }

  async pair({
    deviceName = "Sclera Client",
    deviceType = "desktop",
    requestedPermissions = [],
  } = {}) {
    const secret = crypto.randomBytes(32).toString("hex");
    const hash = crypto.createHash("sha256").update(secret).digest("hex");

    const linkPayload = {
      deviceName,
      deviceType,
      verificationHash: hash,
      requestedPermissions,
    };

    const subdevices = this.getSubdevices();
    if (subdevices.length > 0) {
      linkPayload.proposedSubdevices = subdevices.map((sd) => sd.toProposed());
    }

    const { deviceId, userCode, expiresIn } = await this.sendAndWaitForResponse("link", linkPayload);
    this.#emit("pairingStarted", { userCode, expiresIn });

    return new Promise((resolve, reject) => {
      const interval = setInterval(async () => {
        try {
          const status = await this.sendAndWaitForResponse("link/status", {
            deviceId,
            verificationSecret: secret,
          });
          if (status.status === "PAIRED") {
            clearInterval(interval);
            this.#config.clientSecret = status.clientSecret;
            this.#config.deviceId = status.deviceId;
            if (this.#configPath) this.#saveConfig();
            this.#emit("paired", status);
            resolve(status);
          }
        } catch (err) {
          clearInterval(interval);
          reject(err);
        }
      }, 3000);
    });
  }

  /**
   * @param {import('./Action.js').default[]} [actions]  Uses catalog when omitted.
   * @param {{ replace?: boolean, sync?: boolean }} [options]
   */
  async registerActions(actions, opts = {}) {
    const { replace, sync } = normalizeRegisterOpts(opts);
    if (actions) {
      for (const action of actions) super.addAction(action);
      for (const action of actions) this._bindCatalogAction(action);
    }
    const list = this.getActions();
    if (!sync) return { ok: true, localOnly: true, actions: list.map((a) => a.export()) };
    return await this.sendAndWaitForResponse("actions/setList", {
      actions: list.map((a) => a.export()),
      replace,
    });
  }

  async getActionsRemote() {
    return await this.sendAndWaitForResponse("actions/getList", {});
  }

  async execAction(actionId, parameters = {}, timeout = 10000) {
    return await this.sendAndWaitForResponse(
      "actions/exec",
      { actions: [{ action: actionId, parameters, timeout }] },
      timeout,
    );
  }

  async getUser() {
    return await this.sendAndWaitForResponse("users/me", {});
  }

  async getScopes() {
    const user = await this.getUser();
    return user?.clientPermissions || user?.oauthScopes || [];
  }

  /**
   * @param {import('./Subdevice.js').default[]} [subdevices]  Uses catalog when omitted.
   * @param {{ replace?: boolean, sync?: boolean }} [options]
   */
  async registerSubdevices(subdevices, opts = {}) {
    const { replace, sync } = normalizeRegisterOpts(opts);
    if (subdevices) {
      for (const sd of subdevices) super.addSubdevice(sd);
      for (const sd of subdevices) this._bindSubdevice(sd);
    }
    const list = this.getSubdevices();
    for (const sd of list) {
      if (!(sd instanceof Subdevice)) {
        throw new Error("All subdevices must be Subdevice instances");
      }
    }

    await this.#ensureHubClientId();
    this._catalog().applySubdeviceActions(this.#subdeviceActions);
    this.#prepareSubdeviceEventKeys(list);
    for (const sd of list) {
      sd._refreshEventBindings();
    }

    if (!sync) return { ok: true, localOnly: true, count: list.length };
    if (list.length === 0) return { ok: true, localOnly: true, count: 0 };

    const response = await this.sendAndWaitForResponse("subdevices/setList", {
      subdevices: list.map((sd) => sd.export()),
      replace,
    });

    const listeners = response?.listeners || [];
    await Promise.all(
      listeners.map((l) =>
        this._sendAuthGrant(
          l.listenerClientId,
          l.listenerPubKey,
          l.eventId,
          l.subscriptionId,
          l.emitterId,
        ),
      ),
    );
    return response;
  }

  /**
   * @param {import('./Event.js').default[]} [events]  Uses catalog when omitted.
   * @param {{ replace?: boolean, sync?: boolean }} [options]
   */
  async registerEvents(events, opts = {}) {
    const { replace, sync } = normalizeRegisterOpts(opts);
    if (events) {
      for (const e of events) super.addEvent(e);
      for (const e of events) this._bindCatalogEvent(e);
    }
    const list = this.getEvents();

    for (const event of list) {
      const key = this.#emitterChannelKey(null, event.id);
      if (!this.#emitterChannelKeys.has(key)) {
        this.#emitterChannelKeys.set(key, crypto.randomBytes(32));
      }
      event._bindClient(this);
    }

    if (!sync) return { ok: true, localOnly: true, listeners: [] };

    const response = await this.sendAndWaitForResponse("events/setList", {
      events: list.map((e) => e.export()),
      replace,
    });

    const listeners = response?.listeners || [];
    await Promise.all(
      listeners.map((l) =>
        this._sendAuthGrant(
          l.listenerClientId,
          l.listenerPubKey,
          l.eventId,
          l.subscriptionId,
          l.emitterId,
        ),
      ),
    );
    return response;
  }

  emitEvent(eventId, payload, targetListenerIds, targetUserIds, { emitterId } = {}) {
    const key = this.#emitterChannelKey(emitterId ?? null, eventId);
    const channelKey = this.#emitterChannelKeys.get(key);
    if (!channelKey) {
      throw new Error(
        `Event "${eventId}" is not registered. Call registerEvents() or registerSubdevices() first.`,
      );
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", channelKey, iv);
    let ct = cipher.update(JSON.stringify(payload), "utf8", "base64");
    ct += cipher.final("base64");
    const authTag = cipher.getAuthTag().toString("base64");

    return this.sendAndWaitForResponse("events/emit", {
      eventId,
      ...(emitterId ? { emitterId } : {}),
      encryptedPayload: ct,
      iv: iv.toString("base64"),
      authTag,
      targetListenerIds,
      targetUserIds,
    });
  }

  async subscribeToEvent(emitterId, eventId, handler) {
    if (!this.#ecdh) throw new Error("Not connected. Call connect() first.");
    const listenerPubKey = this.#ecdh.getPublicKey("base64");
    this.#eventCallbacks.set(`${emitterId}:${eventId}`, handler);
    return await this.sendAndWaitForResponse("events/subscribe", {
      emitterId,
      eventId,
      listenerPubKey,
    });
  }

  async unsubscribeFromEvent(emitterId, eventId) {
    this.#channelKeys.delete(`${emitterId}:${eventId}`);
    this.#eventCallbacks.delete(`${emitterId}:${eventId}`);
    return await this.sendAndWaitForResponse("events/unsubscribe", { emitterId, eventId });
  }

  async getPendingRequests() {
    return await this.sendAndWaitForResponse("events/getPendingRequests", {});
  }

  async approveSubscription(subscriptionId) {
    return await this.sendAndWaitForResponse("events/approve", { subscriptionId });
  }

  async rejectSubscription(subscriptionId) {
    return await this.sendAndWaitForResponse("events/reject", { subscriptionId });
  }

  async revokeSubscription(listenerClientId, eventId, emitterId) {
    return await this.sendAndWaitForResponse("events/revokeSubscription", {
      listenerClientId,
      eventId,
      emitterId,
    });
  }

  async getEventList() {
    return await this.sendAndWaitForResponse("events/getList", {});
  }

  async getSubscriptions() {
    return await this.sendAndWaitForResponse("events/getSubscriptions", {});
  }

  async _sendAuthGrant(listenerClientId, listenerPubKey, eventId, subscriptionId = null, emitterId = null) {
    const key = this.#emitterChannelKey(emitterId ?? null, eventId);
    const channelKey = this.#emitterChannelKeys.get(key);
    if (!channelKey) return;

    const ephemeral = crypto.createECDH("prime256v1");
    ephemeral.generateKeys();
    const sharedSecret = ephemeral.computeSecret(Buffer.from(listenerPubKey, "base64"));
    const encryptKey = crypto.createHash("sha256").update(sharedSecret).digest();

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptKey, iv);
    let ct = cipher.update(channelKey);
    ct = Buffer.concat([ct, cipher.final()]);
    const authTag = cipher.getAuthTag();

    await this.sendAndWaitForResponse("events/authGrant", {
      targetListenerClientId: listenerClientId,
      subscriptionId,
      eventId,
      ...(emitterId ? { emitterId } : {}),
      encryptedKey: ct.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      emitterPubKey: ephemeral.getPublicKey("base64"),
    });
  }

  _handleSubGranted(data) {
    const { listenerClientId, listenerPubKey, eventId, subscriptionId, emitterId } = data;
    this._sendAuthGrant(listenerClientId, listenerPubKey, eventId, subscriptionId, emitterId).catch((err) =>
      console.error("[sclera] Failed to send authGrant:", err.message),
    );
  }

  _handleAuthGrant(data) {
    const { emitterId, eventId, encryptedKey, iv, authTag, emitterPubKey } = data;
    try {
      const sharedSecret = this.#ecdh.computeSecret(Buffer.from(emitterPubKey, "base64"));
      const decryptKey = crypto.createHash("sha256").update(sharedSecret).digest();

      const decipher = crypto.createDecipheriv("aes-256-gcm", decryptKey, Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(authTag, "base64"));
      const channelKey = Buffer.concat([
        decipher.update(Buffer.from(encryptedKey, "base64")),
        decipher.final(),
      ]);
      this.#channelKeys.set(`${emitterId}:${eventId}`, channelKey);
    } catch (err) {
      console.error(`[sclera] Failed to decrypt authGrant for ${emitterId}:${eventId}:`, err.message);
    }
  }

  _handleIncoming(data) {
    const { emitterId, eventId, encryptedPayload, iv, authTag } = data;
    const channelKey = this.#channelKeys.get(`${emitterId}:${eventId}`);
    if (!channelKey) return;

    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", channelKey, Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(authTag, "base64"));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(encryptedPayload, "base64")),
        decipher.final(),
      ]);
      const payload = JSON.parse(plain.toString("utf8"));

      const handler = this.#eventCallbacks.get(`${emitterId}:${eventId}`);
      if (handler) handler(payload);
      this.#emit("events/incoming", { emitterId, eventId, payload });
    } catch (err) {
      console.error(`[sclera] Failed to decrypt event ${emitterId}:${eventId}:`, err.message);
    }
  }

  send(type, data = {}) {
    this.#ws.send(JSON.stringify({ type, data }));
  }

  sendAndWaitForResponse(type, data = {}, timeout = 10000) {
    const messageId = "c_" + crypto.randomUUID();
    this.#ws.send(JSON.stringify({ type, data, messageId }));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingResponses.delete(messageId);
        reject(new Error(`Timeout waiting for response to "${type}"`));
      }, timeout);
      this.#pendingResponses.set(messageId, { resolve, reject, timer });
    });
  }

  on(event, handler) {
    if (!this.#eventHandlers[event]) this.#eventHandlers[event] = [];
    this.#eventHandlers[event].push(handler);
    return this;
  }

  #emit(event, ...args) {
    for (const handler of this.#eventHandlers[event] || []) handler(...args);
  }

  #handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const { type, data, error, messageId } = msg;

    if (messageId && type !== "ack" && this.#pendingResponses.has(messageId)) {
      const pending = this.#pendingResponses.get(messageId);
      this.#pendingResponses.delete(messageId);
      clearTimeout(pending.timer);
      if (error) {
        const detail =
          error.details != null ? ` ${JSON.stringify(error.details)}` : "";
        pending.reject(new Error((error.message || "Error") + detail));
      }
      else pending.resolve(data);
      return;
    }

    if (messageId && messageId.startsWith("s_")) {
      this.#ws.send(JSON.stringify({ type: "ack", messageId }));
    }

    switch (type) {
      case "events/subGranted":
        this._handleSubGranted(data);
        break;
      case "events/authGrant":
        this._handleAuthGrant(data);
        break;
      case "events/incoming":
        this._handleIncoming(data);
        break;
      case "events/subRequest":
        this.#emit("events/subRequest", data);
        break;
      case "events/subscriptionRevoked":
        this.#channelKeys.delete(`${data.emitterId}:${data.eventId}`);
        this.#eventCallbacks.delete(`${data.emitterId}:${data.eventId}`);
        this.#emit("events/subscriptionRevoked", data);
        break;
      case "events/subscriptionRejected":
        this.#emit("events/subscriptionRejected", data);
        break;
      case "actions/plsExec":
        this._handlePlsExec(data, messageId);
        break;
      default:
        this.#emit("message", msg);
        break;
    }
  }

  #buildExecContext({ externalId, subdeviceId }) {
    const ext = externalId ?? null;
    const subdevice = ext ? this.getSubdevice(ext) : null;
    let targetId = subdeviceId ?? null;
    if (!targetId && ext) {
      const parentId = this.#hubClientId ?? this.#config.deviceId ?? null;
      if (parentId) targetId = buildSubdevicePublicId(parentId, ext);
    }
    return {
      externalId: ext,
      targetId,
      subdeviceId: targetId,
      subdevice,
    };
  }

  async _handlePlsExec(data, messageId) {
    const { actionName, parameters, caller, externalId, subdeviceId } = data;
    let action = this.getAction(actionName);
    if (!action && externalId) {
      action = this.#subdeviceActions.get(externalId)?.get(actionName);
    }
    try {
      if (!action) {
        throw new Error(
          `Unknown action: ${actionName}${externalId ? ` for ${externalId}` : ""}`,
        );
      }
      const result = await action.exec(
        parameters || {},
        caller,
        this.#buildExecContext({ externalId, subdeviceId }),
      );
      this.#ws.send(JSON.stringify({ type: "actions/plsExec", data: result, messageId }));
    } catch (err) {
      this.#ws.send(JSON.stringify({
        type: "actions/plsExec",
        error: { message: err.message },
        messageId,
      }));
    }
  }

  #loadConfig() {
    try {
      if (fs.existsSync(this.#configPath)) {
        this.#config = JSON.parse(fs.readFileSync(this.#configPath, "utf-8"));
      }
    } catch {
      this.#config = {};
    }
  }

  #saveConfig() {
    if (!this.#configPath) return;
    const dir = path.dirname(this.#configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.#configPath, JSON.stringify(this.#config, null, 2));
  }
}
