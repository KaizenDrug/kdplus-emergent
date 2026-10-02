import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { InlineText, InlineNumber } from "../components/ProductInlineFields";

global.IS_REACT_ACT_ENVIRONMENT = true;
let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const change = async (input, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const blur = async (input) => act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));

test("saves a text change on blur once and leaves unchanged cells alone", async () => {
  const save = jest.fn().mockResolvedValue(undefined);
  await act(async () => root.render(<InlineText value="Old name" onSave={save} />));
  const input = container.querySelector("input");
  await blur(input);
  expect(save).not.toHaveBeenCalled();
  await change(input, "New name");
  await blur(input);
  expect(save).toHaveBeenCalledWith("New name");
  expect(save).toHaveBeenCalledTimes(1);
});

test("Escape cancels a text edit without sending the changed value", async () => {
  const save = jest.fn();
  await act(async () => root.render(<InlineText value="SKU10001" onSave={save} />));
  const input = container.querySelector("input");
  await act(async () => input.focus());
  await change(input, "SKU10002");
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(input.value).toBe("SKU10001");
  expect(save).not.toHaveBeenCalled();
});

test("failed save restores the saved field value", async () => {
  const save = jest.fn().mockRejectedValue(new Error("Duplicate SKU"));
  await act(async () => root.render(<InlineText value="SKU10001" onSave={save} />));
  const input = container.querySelector("input");
  await change(input, "SKU10002");
  await blur(input);
  expect(input.value).toBe("SKU10001");
});

test("clearing a numeric zero reaches validation and does not silently become zero", async () => {
  const save = jest.fn().mockRejectedValue(new Error("Required amount"));
  await act(async () => root.render(<InlineNumber value={0} onSave={save} />));
  const input = container.querySelector("input");
  await change(input, "");
  await blur(input);
  expect(save).toHaveBeenCalledWith("");
  expect(input.value).toBe("0");
});
