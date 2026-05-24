import WebSocket from "ws";
import crypto from "crypto";
import fs from "fs";
import path from "path";

export default class ScleraClient {
  #url;
  #ws;
  #actions = new Map();
  #pendingResponses = new Map();
  #configPath;
  #config = {};
  #eventHandlers = {};
  #heartbeatInterval;

  // Event system state
  #ecdh = null;                     // ECDH P-256 key pair — regenerated on every connect()
  #emitterChannelKeys = new Map();  // eventId → Buffer(32) — AES-256 channel keys as emitter
  #channelKeys = new Map();         // "emitterId:eventId" → Buffer(32) — channel keys as listener
  #eventCallbacks = new Map();      // "emitterId:eventId" → handler function

  constructor({ url = "wss://apisclera.darye.dev/ws", configPath = "client_config.json" } = {}) {
    this.#url = url;
    this.#configPath = configPath;
    if (configPath) this.#loadConfig();
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────

  connect() {
    return new Promise((resolve, reject) => {
      // Fresh ECDH key pair on every connection (no key reuse across sessions)
      this.#ecdh = crypto.createECDH("prime256v1");
      this.#ecdh.generateKeys();

      // Clear stale channel keys from previous session
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

  // ── Auth ──────────────────────────────────────────────────────────────────

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
      this.#emit("loggedIn", response);
      return response;
    }
    throw new Error(response?.message || "Login failed");
  }

  // ── Pairing ───────────────────────────────────────────────────────────────

  async pair({ deviceName = "Sclera Client", deviceType = "desktop", requestedPermissions = [] } = {}) {
    const secret = crypto.randomBytes(32).toString("hex");
    const hash = crypto.createHash("sha256").update(secret).digest("hex");

    const { deviceId, userCode, expiresIn } = await this.sendAndWaitForResponse("link", {
      deviceName, deviceType, verificationHash: hash, requestedPermissions,
    });
    this.#emit("pairingStarted", { userCode, expiresIn });

    return new Promise((resolve, reject) => {
      const interval = setInterval(async () => {
        try {
          const status = await this.sendAndWaitForResponse("link/status", { deviceId, verificationSecret: secret });
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

  // ── Actions ───────────────────────────────────────────────────────────────

  registerActions(actions) {
    for (const action of actions) this.#actions.set(action.id, action);
    return this.send("actions/setList", { actions: actions.map((a) => a.export()) });
  }

  async getActions() {
    return await this.sendAndWaitForResponse("actions/getList", {});
  }

  async execAction(actionId, parameters = {}, timeout = 10000) {
    return await this.sendAndWaitForResponse("actions/exec", {
      actions: [{ action: actionId, parameters, timeout }],
    }, timeout);
  }

  async getUser() {
    return await this.sendAndWaitForResponse("users/me", {});
  }

  async getScopes() {
    const user = await this.getUser();
    return user?.clientPermissions || user?.oauthScopes || [];
  }

  // ── Event system — Emitter ────────────────────────────────────────────────

  /**
   * Declares event types and distributes channel keys to any currently-authorized listeners.
   * Always await this before emitting events to guarantee key delivery.
   * @param {Event[]} events
   * @returns {Promise<void>}
   */
  async registerEvents(events) {
    for (const event of events) {
      if (!this.#emitterChannelKeys.has(event.id)) {
        this.#emitterChannelKeys.set(event.id, crypto.randomBytes(32));
      }
      event._bindClient(this);
    }

    const response = await this.sendAndWaitForResponse("events/setList", {
      events: events.map((e) => e.export()),
    });

    // Distribute channel key to all currently-authorized listeners
    const listeners = response?.listeners || [];
    await Promise.all(listeners.map((l) => this._sendAuthGrant(l.listenerClientId, l.listenerPubKey, l.eventId, l.subscriptionId)));
  }

  /**
   * Encrypts and emits a payload. Always returns a Promise with delivery results.
   * Use `await` to get results or ignore for fire-and-forget.
   * @param {string} eventId
   * @param {object} payload
   * @returns {Promise<{delivered: number, failed: Array<{listenerClientId: string, reason: string}>}>}
   */
  emitEvent(eventId, payload) {
    const channelKey = this.#emitterChannelKeys.get(eventId);
    if (!channelKey) throw new Error(`Event "${eventId}" not registered. Call registerEvents() first.`);

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", channelKey, iv);
    let ct = cipher.update(JSON.stringify(payload), "utf8", "base64");
    ct += cipher.final("base64");
    const authTag = cipher.getAuthTag().toString("base64");

    return this.sendAndWaitForResponse("events/emit", {
      eventId,
      encryptedPayload: ct,
      iv: iv.toString("base64"),
      authTag,
    });
  }

  // ── Event system — Listener ───────────────────────────────────────────────

  /**
   * Subscribe to an event. Call on every connection for each event of interest.
   * @returns {Promise<{status: 'ACTIVE'|'PENDING', subscriptionId: string}>}
   */
  async subscribeToEvent(emitterId, eventId, handler) {
    if (!this.#ecdh) throw new Error("Not connected. Call connect() first.");
    const listenerPubKey = this.#ecdh.getPublicKey("base64");
    this.#eventCallbacks.set(`${emitterId}:${eventId}`, handler);
    return await this.sendAndWaitForResponse("events/subscribe", { emitterId, eventId, listenerPubKey });
  }

  async unsubscribeFromEvent(emitterId, eventId) {
    this.#channelKeys.delete(`${emitterId}:${eventId}`);
    this.#eventCallbacks.delete(`${emitterId}:${eventId}`);
    return await this.sendAndWaitForResponse("events/unsubscribe", { emitterId, eventId });
  }

  // ── Event system — Authorizer ─────────────────────────────────────────────

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
    return await this.sendAndWaitForResponse("events/revokeSubscription", { listenerClientId, eventId, emitterId });
  }

  async getEventList() {
    return await this.sendAndWaitForResponse("events/getList", {});
  }

  async getSubscriptions() {
    return await this.sendAndWaitForResponse("events/getSubscriptions", {});
  }

  // ── Internal crypto helpers ───────────────────────────────────────────────

  // Generates and sends an authGrant (encrypted channel key) to a listener
  async _sendAuthGrant(listenerClientId, listenerPubKey, eventId, subscriptionId = null) {
    const channelKey = this.#emitterChannelKeys.get(eventId);
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
      encryptedKey: ct.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      emitterPubKey: ephemeral.getPublicKey("base64"),
    });
  }

  // Called when server pushes events/subGranted — the emitter must send an authGrant
  _handleSubGranted(data) {
    const { listenerClientId, listenerPubKey, eventId, subscriptionId } = data;
    this._sendAuthGrant(listenerClientId, listenerPubKey, eventId, subscriptionId).catch((err) =>
      console.error("[sclera] Failed to send authGrant:", err.message)
    );
  }

  // Called when server pushes events/authGrant — decrypt and store the channel key
  _handleAuthGrant(data) {
    const { emitterId, eventId, encryptedKey, iv, authTag, emitterPubKey } = data;
    try {
      const sharedSecret = this.#ecdh.computeSecret(Buffer.from(emitterPubKey, "base64"));
      const decryptKey = crypto.createHash("sha256").update(sharedSecret).digest();

      const decipher = crypto.createDecipheriv("aes-256-gcm", decryptKey, Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(authTag, "base64"));
      const channelKey = Buffer.concat([decipher.update(Buffer.from(encryptedKey, "base64")), decipher.final()]);
      this.#channelKeys.set(`${emitterId}:${eventId}`, channelKey);
    } catch (err) {
      console.error(`[sclera] Failed to decrypt authGrant for ${emitterId}:${eventId}:`, err.message);
    }
  }

  // Called when server pushes events/incoming — decrypt and call the handler
  _handleIncoming(data) {
    const { emitterId, eventId, encryptedPayload, iv, authTag } = data;
    const channelKey = this.#channelKeys.get(`${emitterId}:${eventId}`);
    if (!channelKey) return; // No key yet — silent discard (race condition)

    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", channelKey, Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(authTag, "base64"));
      const plain = Buffer.concat([decipher.update(Buffer.from(encryptedPayload, "base64")), decipher.final()]);
      const payload = JSON.parse(plain.toString("utf8"));

      const handler = this.#eventCallbacks.get(`${emitterId}:${eventId}`);
      if (handler) handler(payload);
      this.#emit("events/incoming", { emitterId, eventId, payload });
    } catch (err) {
      console.error(`[sclera] Failed to decrypt event ${emitterId}:${eventId}:`, err.message);
    }
  }

  // ── Messaging ─────────────────────────────────────────────────────────────

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

  // ── SDK event emitter ─────────────────────────────────────────────────────

  on(event, handler) {
    if (!this.#eventHandlers[event]) this.#eventHandlers[event] = [];
    this.#eventHandlers[event].push(handler);
    return this;
  }

  #emit(event, ...args) {
    for (const handler of this.#eventHandlers[event] || []) handler(...args);
  }

  // ── Internal message router ───────────────────────────────────────────────

  #handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const { type, data, error, messageId } = msg;

    // Resolve pending request/response pairs
    if (messageId && type !== "ack" && this.#pendingResponses.has(messageId)) {
      const pending = this.#pendingResponses.get(messageId);
      this.#pendingResponses.delete(messageId);
      clearTimeout(pending.timer);
      if (error) pending.reject(new Error(error.message || "Error"));
      else pending.resolve(data);
      return;
    }

    // ACK for server-push messages (events/incoming etc.)
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

  async _handlePlsExec(data, messageId) {
    const { actionName, parameters, caller } = data;
    const action = this.#actions.get(actionName);
    try {
      if (!action) throw new Error(`Unknown action: ${actionName}`);
      const result = await action.exec(parameters || {}, caller);
      this.#ws.send(JSON.stringify({ type: "actions/plsExec", data: result, messageId }));
    } catch (err) {
      this.#ws.send(JSON.stringify({ type: "actions/plsExec", error: { message: err.message }, messageId }));
    }
  }

  // ── Config persistence ────────────────────────────────────────────────────

  #loadConfig() {
    try {
      if (fs.existsSync(this.#configPath)) {
        this.#config = JSON.parse(fs.readFileSync(this.#configPath, "utf-8"));
      }
    } catch { this.#config = {}; }
  }

  #saveConfig() {
    if (!this.#configPath) return;
    const dir = path.dirname(this.#configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.#configPath, JSON.stringify(this.#config, null, 2));
  }
}
