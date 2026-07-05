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