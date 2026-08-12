/**
 * Declaring JSON Schema (draft-07) on event payload fields and action outputs.
 * Register these on a Device with registerEvents / registerActions, then emit/exec as usual.
 * Invalid values throw locally and are not sent.
 */
import {
  Action,
  ActionOutput,
  ActionParameter,
  Event,
  EventPayloadVariable,
} from "@sclera/sdk";

const orderSchema = {
  type: "object",
  additionalProperties: true,
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

export const orderPlaced = new Event("order_placed")
  .setName("Order Placed")
  .setAutoAccept(true)
  .addPayloadVariable(
    new EventPayloadVariable("order")
      .setName("Order")
      .setType("object")
      .setOutputSchema(orderSchema),
  )
  .addPayloadVariable(
    new EventPayloadVariable("note")
      .setName("Note")
      .setType("string")
      .setOutputSchema({ type: "string", minLength: 1 }),
  );

export const getOrder = new Action("get_order")
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
  .setExec(async (params) => ({
    id: params.id,
    total: 12.5,
    customer: { name: "Ada", email: "ada@example.com" },
  }));
