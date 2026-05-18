import crypto from "crypto";

export default class App {
  #clientId;
  #clientSecret;
  #scleraUrl;
  #webhookSigningSecret;
  #actions = new Map();
  #eventHandlers = {};

  // Event system state
  #ecdh; // ECDH P-256 key pair — persists for the lifetime of the instance
  #emitterChannelKeys = new Map(); // eventId → Buffer(32)
  #channelKeys = new Map(); // "emitterId:eventId" → Buffer(32)
  #eventCallbacks = new Map(); // "emitterId:eventId" → handler

  /**
   * @param {object} opts
   * @param {string}  opts.clientId
   * @param {string}  opts.clientSecret
   * @param {string} [opts.scleraUrl]
   * @param {string} [opts.webhookSigningSecret]  Plain-text webhook signing secret
   *   (value of SCLERA_WEBHOOK_SIGNING_SECRET). When provided, webhookHandler()
   *   automatically verifies every incoming request signature.
   */
  constructor({ clientId, clientSecret, scleraUrl = "http://localhost:3000", webhookSigningSecret } = {}) {
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
    this.#scleraUrl = scleraUrl;
    this.#webhookSigningSecret = webhookSigningSecret ?? null;

    this.#ecdh = crypto.createECDH("prime256v1");
    this.#ecdh.generateKeys();
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async registerActions(actions) {
    for (const action of actions) this.#actions.set(action.id, action);
    const response = await fetch(`${this.#scleraUrl}/oauth/apps/${this.#clientId}/actions`, {
      method: "PUT",
      headers: { Authorization: this.#basicAuth(), "Content-Type": "application/json" },
      body: JSON.stringify(actions.map((a) => a.export())),
    });
    if (!response.ok) throw new Error(`Failed to register actions: ${await response.text()}`);
    return response.json();
  }

  async getActions() {
    const response = await fetch(`${this.#scleraUrl}/oauth/apps/${this.#clientId}/actions`, {
      headers: { Authorization: this.#basicAuth() },
    });
    if (!response.ok) throw new Error(`Failed to get actions: ${await response.text()}`);
    return response.json();
  }

  async execAction(actionId, parameters, timeout = 10000, { accessToken } = {}) {
    if (!accessToken) throw new Error("execAction requires an accessToken");
    const response = await fetch(`${this.#scleraUrl}/actions/exec`, {
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
  async registerEvents(events) {
    for (const event of events) {
      if (!this.#emitterChannelKeys.has(event.id)) {
        this.#emitterChannelKeys.set(event.id, crypto.randomBytes(32));
      }
      event._bindClient(this);
    }

    const response = await this.#put("/events/types", events.map((e) => e.export()));
    const listeners = response?.listeners || [];
    await Promise.all(listeners.map((l) => this.#sendAuthGrant(l.listenerClientId, l.listenerPubKey, l.eventId, l.subscriptionId)));
  }

  /**
   * Encrypts and emits a payload via HTTP.
   * @returns {Promise<{delivered: number, failed: Array}>}
   */
  async emitEvent(eventId, payload) {
    const channelKey = this.#emitterChannelKeys.get(eventId);
    if (!channelKey) throw new Error(`Event "${eventId}" not registered. Call registerEvents() first.`);

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", channelKey, iv);
    let ct = cipher.update(JSON.stringify(payload), "utf8", "base64");
    ct += cipher.final("base64");
    const authTag = cipher.getAuthTag().toString("base64");

    const result = await this.#post("/events/emit", {
      eventId,
      encryptedPayload: ct,
      iv: iv.toString("base64"),
      authTag,
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
          const { action, parameters, caller } = data;
          const actionObj = this.#actions.get(action);
          if (!actionObj) return res.status(404).json({ error: { message: `Unknown action: ${action}` } });
          Promise.resolve(actionObj.exec(parameters || {}, caller))
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

  async #sendAuthGrant(listenerClientId, listenerPubKey, eventId, subscriptionId = null) {
    const channelKey = this.#emitterChannelKeys.get(eventId);
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
      encryptedKey: ct.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      emitterPubKey: ephemeral.getPublicKey("base64"),
    });
  }

  #handleSubGranted(data) {
    const { listenerClientId, listenerPubKey, eventId, subscriptionId } = data;
    this.#sendAuthGrant(listenerClientId, listenerPubKey, eventId, subscriptionId).catch((err) =>
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
    const response = await fetch(`${this.#scleraUrl}${path}`, {
      method: "POST",
      headers: { Authorization: this.#basicAuth(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  async #put(path, body) {
    const response = await fetch(`${this.#scleraUrl}${path}`, {
      method: "PUT",
      headers: { Authorization: this.#basicAuth(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  async #get(path) {
    const response = await fetch(`${this.#scleraUrl}${path}`, {
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
