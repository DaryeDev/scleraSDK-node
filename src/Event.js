export default class Event {
  #id;
  #name;
  #description;
  #autoAccept = true;
  #payloadVariables = [];
  #client = null;

  setId(id)                        { this.#id = id; return this; }
  setName(name)                    { this.#name = name; return this; }
  setDescription(desc)             { this.#description = desc; return this; }
  setAutoAccept(autoAccept)        { this.#autoAccept = autoAccept; return this; }
  setPayloadVariables(vars)        { this.#payloadVariables = vars; return this; }
  addPayloadVariable(variable)     { this.#payloadVariables.push(variable); return this; }

  get id() { return this.#id; }

  // Called by registerEvents() to bind the event to a client instance
  _bindClient(client) { this.#client = client; return this; }

  emit(payload, targetListenerIds = undefined, targetUserIds = undefined) {
    if (!this.#client) throw new Error(`Event "${this.#id}" is not registered. Call registerEvents() first.`);
    return this.#client.emitEvent(this.#id, payload, targetListenerIds, targetUserIds);
  }

  export() {
    const schema = this.#payloadVariables.length
      ? { type: 'object', properties: Object.fromEntries(this.#payloadVariables.map(v => [v.id, v.export()])) }
      : undefined;
    return {
      id: this.#id,
      name: this.#name,
      ...(this.#description && { description: this.#description }),
      autoAccept: this.#autoAccept,
      ...(schema && { payloadSchema: schema }),
    };
  }
}
