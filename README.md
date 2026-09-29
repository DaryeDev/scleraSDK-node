# @sclera/sdk (Node)

Client SDK for Sclera devices, OAuth hub apps, actions, subdevices, and events.

```javascript
import { Action, Device, Subdevice, App } from "@sclera/sdk";

const action = new Action("turn_on")
  .setName("Turn on")
  .setColor("#34D399");

const light = new Subdevice({
  externalId: "light.kitchen",
  name: "Kitchen light",
  deviceType: "light",
  color: "#F59E0B",
  actions: [action],
});

const hub = new Device({
  url: "ws://localhost:3000/ws",
  color: "#64748B",
  subdevices: [light],
});

await hub.connect();
await hub.login(); // syncs color via connection/setProfile

// OAuth hub app
const app = new App({
  clientId: "...",
  clientSecret: "...",
  isHub: true,
  color: "#64748B",
});
await app.registerSubdevices(subdeviceList); // also syncs profile when color is set
```

## Device/subdevice status (4 states)

Every `Device`/`App` connection and every `Subdevice` has a computed 4-state
status: `disconnected` | `unauthorized` | `degraded` | `connected`.
`disconnected` is transport-level and always wins; `unauthorized` /
`degraded` are set live by your plugin and only shown while connected
(`unauthorized` wins if both are set).

```javascript
// On the subdevice itself
light.setUnauthorized(true, { message: "Token expired, please re-link." });
light.unauthorized;   // true
light.status;          // "unauthorized"
light.setUnauthorized(false); // clears it

light.setDegraded(true, { message: "Rate limited, retrying." });
light.status;          // "degraded"

// On the main connection (hub/device/app itself)
hub.setUnauthorized(true, { message: "Hub credentials revoked." });
hub.status;             // "unauthorized" (while hub.connected is true)
```

Both changes sync live to the server (debounced, like other catalog
changes) and propagate to the flow editor in real time. Backward compatible:
`connected` stays a plain boolean everywhere; `status`/`statusMessage` are
additive and omitted from `export()` until you actually set them.

## outputSchema (JSON Schema draft-07)

`EventPayloadVariable` and `ActionOutput` accept an optional JSON Schema via `setOutputSchema()`. The flow editor uses it to expand object keys. The SDK validates values **before** they leave the client.

- If `outputSchema` is set, that schema is the source of truth (Ajv, draft-07). The declared `type` is not used for that field.
- If `outputSchema` is omitted, the SDK only checks the declared `type` (`string` | `number` | `boolean` | `object` | `array`).
- Missing keys in the payload/result are allowed. Extra keys are allowed unless the schema sets `additionalProperties: false`.
- A failed check throws; the event is not emitted and the action result is not returned.

`setType()` only accepts the types listed above.

```javascript
import {
  Action,
  ActionOutput,
  ActionParameter,
  Event,
  EventPayloadVariable,
} from "@sclera/sdk";

const orderSchema = {
  type: "object",
  required: ["id", "total"],
  properties: {
    id: { type: "string", minLength: 1 },
    total: { type: "number", minimum: 0 },
    customer: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string", format: "email" },
      },
    },
  },
};

const orderPlaced = new Event("order_placed")
  .setName("Order Placed")
  .addPayloadVariable(
    new EventPayloadVariable("order")
      .setName("Order")
      .setType("object")
      .setOutputSchema(orderSchema),
  );

const getOrder = new Action("get_order")
  .setName("Get Order")
  .addParameter(
    new ActionParameter("id").setName("Id").setType("string").setRequired(true),
  )
  .addOutput(
    new ActionOutput("order")
      .setName("Order")
      .setType("object")
      .setOutputSchema(orderSchema),
  )
  .setExec(async (params) => {
    return { id: params.id, total: 12.5, customer: { name: "Ada" } };
  });

// Event.emit validates payload fields that are present.
await orderPlaced.emit({
  order: { id: "ord_1", total: 12.5, customer: { name: "Ada" } },
});

// Action.exec validates each output that is present on the result.
```

You can also pass `outputSchema` in the constructor options object:

```javascript
new ActionOutput({
  id: "order",
  name: "Order",
  type: "object",
  outputSchema: orderSchema,
});
```
