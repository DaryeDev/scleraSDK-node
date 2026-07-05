import crypto from "crypto";
import ResourceHost from "./ResourceHost.js";
import Subdevice from "./Subdevice.js";
import { buildSubdevicePublicId } from "./subdeviceId.js";
import { normalizeOptionalColor } from "./color.js";

export default class App extends ResourceHost {
  #clientId;
  #clientSecret;
  #scleraUrl;
  #apiBasePath;
  #webhookSigningSecret;
  #isHub;
  #color;
  #appInternalId = null;
  /** @type {Map<string, Map<string, import('./Action.js').default>>} */
  #subdeviceActions = new Map();
  #eventHandlers = {};

  // Event system state
  #ecdh; // ECDH P-256 key pair — persists for the lifetime of the instance
  #emitterChannelKeys = new Map(); // "emitterId:eventId" or eventId (hub) → Buffer(32)
  #channelKeys = new Map(); // "emitterId:eventId" → Buffer(32)
  #eventCallbacks = new Map(); // "emitterId:eventId" → handler

  /**
   * @param {object} opts
   * @param {string}  opts.clientId
   * @param {string}  opts.clientSecret
   * @param {string} [opts.scleraUrl]  Public origin of the API server (scheme + host [:port], no path), same role as SERVER_PUBLIC_URL in backend `.env`.
   * @param {string} [opts.apiBasePath]  HTTP API prefix on that host (default /api)
   * @param {string} [opts.webhookSigningSecret]  Plain-text webhook signing secret
   *   (value of SCLERA_WEBHOOK_SIGNING_SECRET). When provided, webhookHandler()
   *   automatically verifies every incoming request signature.
   * @param {boolean} [opts.isHub]  When true, declares this OAuth app as a Sclera hub on registerActions/registerSubdevices.
   * @param {string} [opts.color]
   * @param {import('./Action.js').default[]} [opts.actions]
   * @param {import('./Event.js').default[]} [opts.events]
   * @param {import('./Subdevice.js').default[]} [opts.subdevices]
   */
  constructor({
    clientId,
    clientSecret,
    scleraUrl = "https://apisclera.darye.dev",
    apiBasePath = "",
    webhookSigningSecret,
    isHub = false,
    color,
    actions = [],
    events = [],
    subdevices = [],
  } = {}) {
    super({ actions, events, subdevices });
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
    this.#scleraUrl = scleraUrl.replace(/\/+$/, "");
    const rawApi = apiBasePath ?? "";
    const trimmed = rawApi.replace(/\/+$/, "");
    this.#apiBasePath = trimmed === "" ? "" : trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    this.#webhookSigningSecret = webhookSigningSecret ?? null;
    this.#isHub = !!isHub;
    if (color !== undefined) this.setColor(color);

    this.#ecdh = crypto.createECDH("prime256v1");
    this.#ecdh.generateKeys();
    this.#bindAllCatalogResources();
  }

  addSubdevice(subdevice) {
    super.addSubdevice(subdevice);
    this._bindSubdevice(subdevice);
    return this;
  }

  removeSubdevice(subdeviceOrExternalId) {
    const key =
      typeof subdeviceOrExternalId === "string"
        ? subdeviceOrExternalId
        : subdeviceOrExternalId?.externalId;
    const sd = key ? this.getSubdevice(key) : undefined;
    if (sd) sd._unbindHost();
    super.removeSubdevice(subdeviceOrExternalId);
    return this;
  }

  _bindSubdevice(subdevice) {
    subdevice._bindHost({
      client: this,
      scheduleSubdeviceSync: () => {},
      rekeySubdevice: (oldKey, sd) => this._catalog().rekeySubdevice(oldKey, sd),
      getPublicId: () =>
        this.#appInternalId
          ? buildSubdevicePublicId(this.#appInternalId, subdevice.externalId)
          : null,
    });
    subdevice._refreshEventBindings();
  }

  #bindAllCatalogResources() {
    for (const sd of this.getSubdevices()) this._bindSubdevice(sd);
  }

  /**
   * @param {string} color  #RRGGBB accent color for this connection in the flow editor.
   */
  setColor(color) {
    this.#color = normalizeOptionalColor(color);
    return this;
  }

  async registerConnectionProfile() {
    if (this.#color === undefined) {
      return { success: true, color: null };
    }
    const response = await fetch(this.#rest(`/oauth/apps/${this.#clientId}/profile`), {
      method: "PUT",
      headers: { Authorization: this.#basicAuth(), "Content-Type": "application/json" },
      body: JSON.stringify({ color: this.#color }),
    });
    if (!response.ok) throw new Error(`Failed to register connection profile: ${await response.text()}`);
    return response.json();
  }

  #emitterChannelKey(emitterId, eventId) {
    return emitterId ? `${emitterId}:${eventId}` : eventId;
  }

  #prepareSubdeviceEventKeys(subdevices) {
    const parentId = this.#appInternalId;
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

  #rest(path) {
    const p = path.startsWith("/") ? path : `/${path}`;
    return `${this.#scleraUrl}${this.#apiBasePath}${p}`;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async registerActions(actions, { replace = true } = {}) {
    if (actions) {
      for (const action of actions) this.addAction(action);
    }
    const list = this.getActions();
    const body = { actions: list.map((a) => a.export()), replace };
    if (this.#isHub) body.is_hub = true;

    const response = await fetch(this.#rest(`/oauth/apps/${this.#clientId}/actions`), {
      method: "PUT",
      headers: { Authorization: this.#basicAuth(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Failed to register actions: ${await response.text()}`);
    const result = await response.json();
    if (this.#color !== undefined) await this.registerConnectionProfile();
    return result;
  }

  /** Actions currently stored on the server for this OAuth app (JSON schema, not Action instances). */
  async fetchRegisteredActions() {
    const response = await fetch(this.#rest(`/oauth/apps/${this.#clientId}/actions`), {
      headers: { Authorization: this.#basicAuth() },
    });
    if (!response.ok) throw new Error(`Failed to fetch actions: ${await response.text()}`);
    return response.json();
  }

  async registerSubdevices(subdevices, { replace = true, accessToken } = {}) {
    if (subdevices) {
      for (const sd of subdevices) this.addSubdevice(sd);
    }
    const list = this.getSubdevices();
    for (const sd of list) {
      if (!(sd instanceof Subdevice)) {
        throw new Error("All subdevices must be Subdevice instances");
      }
    }
    this._catalog().applySubdeviceActions(this.#subdeviceActions);

    const headers = { Authorization: this.#basicAuth(), "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const body = {
      subdevices: list.map((sd) => sd.export()),
      replace,
    };
    if (this.#isHub && !accessToken) body.is_hub = true;

    const response = await fetch(this.#rest(`/oauth/apps/${this.#clientId}/subdevices`), {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Failed to register subdevices: ${await response.text()}`);

    const result = await response.json();
    const rows = result?.subdevices ?? result?.rows ?? [];
    if (rows.length > 0 && rows[0].parentId) {
      this.#appInternalId = rows[0].parentId;
    }
    this.#prepareSubdeviceEventKeys(list);
    for (const sd of list) sd._refreshEventBindings();

    const listeners = result?.listeners || [];
    await Promise.all(
      listeners.map((l) =>
        this.#sendAuthGrant(l.listenerClientId, l.listenerPubKey, l.eventId, l.subscriptionId, l.emitterId),
      ),
    );
    if (this.#color !== undefined) await this.registerConnectionProfile();
    return result;
  }

  async execAction(actionId, parameters, timeout = 10000, { accessToken } = {}) {
    if (!accessToken) throw new Error("execAction requires an accessToken");
    const response = await fetch(this.#rest("/actions/exec"), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ actions: [{ action: actionId, parameters }] }),
    });
    if (!response.ok) throw new Error(`Failed to execute action: ${await response.text()}`);
    return response.json();
  }

  // ── Event system — Emitter ────────────────────────────────────────────────

  /**
   * Registers event types. Generates channel keys and distributes to current listeners.
   * @param {Event[]} events
   * @returns {Promise<void>}
   */
  async registerEvents(events, { replace = true } = {}) {
    if (events) {
      for (const event of events) this.addEvent(event);
    }
    const list = this.getEvents();

    for (const event of list) {
      const key = this.#emitterChannelKey(null, event.id);
      if (!this.#emitterChannelKeys.has(key)) {
        this.#emitterChannelKeys.set(key, crypto.randomBytes(32));
      }
      event._bindClient(this);
    }

    const response = await this.#put(
      `/events/types?replace=${replace ? "true" : "false"}`,
      list.map((e) => e.export()),
    );
    const listeners = response?.listeners || [];
    await Promise.all(
      listeners.map((l) =>
        this.#sendAuthGrant(l.listenerClientId, l.listenerPubKey, l.eventId, l.subscriptionId, l.emitterId),
      ),
    );
  }

  /**
   * Encrypts and emits a payload via HTTP.
   * @param {string} eventId
   * @param {object} payload
   * @param {string[]} [targetListenerIds]
   * @param {string[]} [targetUserIds]
   * @param {{ emitterId?: string }} [opts]
   * @returns {Promise<{delivered: number, failed: Array}>}
   */
  async emitEvent(eventId, payload, targetListenerIds, targetUserIds, { emitterId } = {}) {
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

    const result = await this.#post("/events/emit", {
      eventId,
      ...(emitterId ? { emitterId } : {}),
      encryptedPayload: ct,
      iv: iv.toString("base64"),
      authTag,
      targetListenerIds,
      targetUserIds,
    });
    return result;
  }

  // ── Event system — Listener ───────────────────────────────────────────────

  async subscribeToEvent(emitterId, eventId, handler) {
    const listenerPubKey = this.#ecdh.getPublicKey("base64");
    this.#eventCallbacks.set(`${emitterId}:${eventId}`, handler);
    return this.#post("/events/subscribe", { emitterId, eventId, listenerPubKey });
  }

  async unsubscribeFromEvent(emitterId, eventId) {
    this.#channelKeys.delete(`${emitterId}:${eventId}`);
    this.#eventCallbacks.delete(`${emitterId}:${eventId}`);
    return this.#post("/events/unsubscribe", { emitterId, eventId });
  }

  // ── Event system — Authorizer ─────────────────────────────────────────────

  async getPendingRequests() { return this.#get("/events/pending"); }
  async approveSubscription(subscriptionId) { return this.#post("/events/approve", { subscriptionId }); }
  async rejectSubscription(subscriptionId) { return this.#post("/events/reject", { subscriptionId }); }
  async revokeSubscription(listenerClientId, eventId, emitterId) {
    return this.#post("/events/revoke", { listenerClientId, eventId, emitterId });
  }
  async getSubscriptions() { return this.#get("/events/subscriptions"); }

  // ── Webhook handler ───────────────────────────────────────────────────────

  /**
   * Returns an Express middleware that handles Sclera server push messages.
   * Mount at your registered webhook URL.
   *
   * When webhookSigningSecret was set in the constructor, signatures are verified
   * using the raw body. Configure express.json with a verify callback first:
   *
   *   app.use(express.json({
   *     verify: (req, _res, buf) => { req.rawBody = buf; }
   *   }));
   */
  webhookHandler() {
    return (req, res) => {
      if (this.#webhookSigningSecret) {
        const rawBody = req.rawBody;
        if (!rawBody) {
          return res.status(400).json({
            error: {
              message:
                "rawBody not available. Configure express.json with a verify callback: " +
                "express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } })",
            },
          });
        }
        try {
          App.verifyWebhookSignature({
            rawBody,
            headers: req.headers,
            signingSecret: this.#webhookSigningSecret,
          });
        } catch (err) {
          return res.status(401).json({ error: { message: err.message } });
        }
      }

      const { type, data } = req.body;

      switch (type) {
        case "events/subGranted":
          res.json({ ok: true }); // ACK immediately
          this.#handleSubGranted(data);
          break;

        case "events/authGrant":
          this.#handleAuthGrant(data);
          res.json({ ok: true });
          break;

        case "events/incoming":
          this.#handleIncoming(data);
          res.json({ ok: true }); // 2xx = ACK
          break;

        case "events/subRequest":
          res.json({ ok: true });
          this.#emitEvent("events/subRequest", data);
          break;

        case "events/subscriptionRevoked":
          this.#channelKeys.delete(`${data.emitterId}:${data.eventId}`);
          this.#eventCallbacks.delete(`${data.emitterId}:${data.eventId}`);
          res.json({ ok: true });
          this.#emitEvent("events/subscriptionRevoked", data);
          break;

        case "events/subscriptionRejected":
          res.json({ ok: true });
          this.#emitEvent("events/subscriptionRejected", data);
          break;

        case "actions/plsExec": {
          const { action, parameters, caller, externalId, subdeviceId } = data;
          let actionObj = this.getAction(action);
          if (!actionObj && externalId) {
            actionObj = this.#subdeviceActions.get(externalId)?.get(action);
          }
          if (!actionObj) return res.status(404).json({ error: { message: `Unknown action: ${action}${externalId ? ` for ${externalId}` : ""}` } });
          const execContext = {
            externalId: externalId ?? null,
            targetId: subdeviceId ?? null,
            subdeviceId: subdeviceId ?? null,
            subdevice: externalId ? this.getSubdevice(externalId) : null,
          };
          Promise.resolve(actionObj.exec(parameters || {}, caller, execContext))
            .then((result) => res.json(result))
            .catch((err) => res.status(500).json({ error: { message: err.message } }));
          break;
        }

        default:
          res.json({ ok: true });
      }
    };
  }

  // ── SDK event emitter ─────────────────────────────────────────────────────

  on(event, handler) {
    if (!this.#eventHandlers[event]) this.#eventHandlers[event] = [];
    this.#eventHandlers[event].push(handler);
    return this;
  }

  #emitEvent(event, ...args) {
    for (const handler of this.#eventHandlers[event] || []) handler(...args);
  }

  // ── Internal crypto ───────────────────────────────────────────────────────

  async #sendAuthGrant(listenerClientId, listenerPubKey, eventId, subscriptionId = null, emitterId = null) {
    const key = this.#emitterChannelKey(emitterId ?? null, eventId);
    const channelKey = this.#emitterChannelKeys.get(key);
    if (!channelKey) return;

    const ephemeral = crypto.createECDH("prime256v1");
    ephemeral.generateKeys();
    const sharedSecret = ephemeral.computeSecret(Buffer.from(listenerPubKey, "base64"));
    const encryptKey = crypto.createHash("sha256").update(sharedSecret).digest();

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptKey, iv);
    const ct = Buffer.concat([cipher.update(channelKey), cipher.final()]);
    const authTag = cipher.getAuthTag();

    await this.#post("/events/authGrant", {
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

  #handleSubGranted(data) {
    const { listenerClientId, listenerPubKey, eventId, subscriptionId, emitterId } = data;
    this.#sendAuthGrant(listenerClientId, listenerPubKey, eventId, subscriptionId, emitterId).catch((err) =>
      console.error("[sclera/app] Failed to send authGrant:", err.message)
    );
  }

  #handleAuthGrant(data) {
    const { emitterId, eventId, encryptedKey, iv, authTag, emitterPubKey } = data;
    try {
      const sharedSecret = this.#ecdh.computeSecret(Buffer.from(emitterPubKey, "base64"));
      const decryptKey = crypto.createHash("sha256").update(sharedSecret).digest();

      const decipher = crypto.createDecipheriv("aes-256-gcm", decryptKey, Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(authTag, "base64"));
      const channelKey = Buffer.concat([decipher.update(Buffer.from(encryptedKey, "base64")), decipher.final()]);
      this.#channelKeys.set(`${emitterId}:${eventId}`, channelKey);
    } catch (err) {
      console.error(`[sclera/app] Failed to decrypt authGrant for ${emitterId}:${eventId}:`, err.message);
    }
  }

  #handleIncoming(data) {
    const { emitterId, eventId, encryptedPayload, iv, authTag } = data;
    const channelKey = this.#channelKeys.get(`${emitterId}:${eventId}`);
    if (!channelKey) return;

    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", channelKey, Buffer.from(iv, "base64"));
      decipher.setAuthTag(Buffer.from(authTag, "base64"));
      const plain = Buffer.concat([decipher.update(Buffer.from(encryptedPayload, "base64")), decipher.final()]);
      const payload = JSON.parse(plain.toString("utf8"));

      const handler = this.#eventCallbacks.get(`${emitterId}:${eventId}`);
      if (handler) handler(payload);
      this.#emitEvent("events/incoming", { emitterId, eventId, payload });
    } catch (err) {
      console.error(`[sclera/app] Failed to decrypt event ${emitterId}:${eventId}:`, err.message);
    }
  }

  // ── HTTP helpers ──────────────────────────────────────────────────────────

  async #post(path, body) {
    const response = await fetch(this.#rest(path), {
      method: "POST",
      headers: { Authorization: this.#basicAuth(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  async #put(path, body) {
    const response = await fetch(this.#rest(path), {
      method: "PUT",
      headers: { Authorization: this.#basicAuth(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  async #get(path) {
    const response = await fetch(this.#rest(path), {
      headers: { Authorization: this.#basicAuth() },
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  /**
   * Verifies a Sclera webhook signature.
   * Throws on failure; resolves silently on success.
   *
   * @param {object}           opts
   * @param {string | Buffer}  opts.rawBody        Raw request body.
   * @param {object}           opts.headers        Request headers object.
   * @param {string}           opts.signingSecret  Plain-text webhook signing secret.
   * @param {number}          [opts.toleranceSeconds]  Max clock skew allowed (default: 300).
   */
  static verifyWebhookSignature({ rawBody, headers, signingSecret, toleranceSeconds = 300 }) {
    const sigHeader = headers["x-sclera-signature"];
    const tsHeader = headers["x-sclera-timestamp"];

    if (!sigHeader || !tsHeader) {
      throw new Error("Missing X-Sclera-Signature or X-Sclera-Timestamp headers");
    }

    const ts = parseInt(tsHeader, 10);
    if (!Number.isFinite(ts)) {
      throw new Error("Invalid X-Sclera-Timestamp value");
    }

    const age = Math.abs(Math.floor(Date.now() / 1000) - ts);
    if (age > toleranceSeconds) {
      throw new Error(`Webhook timestamp too old (${age}s > ${toleranceSeconds}s tolerance)`);
    }

    const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    const secretHashHex = crypto.createHash("sha256").update(signingSecret, "utf8").digest("hex");
    const key = Buffer.from(secretHashHex, "hex");
    const expected = `sha256=${crypto.createHmac("sha256", key).update(`${ts}.${body}`, "utf8").digest("hex")}`;

    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(sigHeader, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new Error("Webhook signature mismatch");
    }
  }

  #basicAuth() {
    return "Basic " + Buffer.from(`${this.#clientId}:${this.#clientSecret}`).toString("base64");
  }
}
