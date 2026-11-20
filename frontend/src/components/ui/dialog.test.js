import { activateDialogDefault } from "./dialog";

function eventFor(target, container, extras = {}) {
  return {
    key: "Enter", target, currentTarget: container,
    preventDefault: jest.fn(), defaultPrevented: false,
    ...extras,
  };
}

test("Enter invokes only an explicit enabled default", () => {
  const root = document.createElement("div");
  root.innerHTML = '<input /><button data-dialog-default="true">Save</button>';
  const click = jest.fn();
  root.querySelector("button").addEventListener("click", click);
  const event = eventFor(root.querySelector("input"), root);
  expect(activateDialogDefault(event)).toBe(true);
  expect(click).toHaveBeenCalledTimes(1);
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
});

test("Enter preserves focused button, textarea, and disabled defaults", () => {
  const root = document.createElement("div");
  root.innerHTML = '<textarea></textarea><button data-dialog-default="true">Save</button>';
  const action = root.querySelector("button");
  const click = jest.fn();
  action.addEventListener("click", click);
  expect(activateDialogDefault(eventFor(root.querySelector("textarea"), root))).toBe(false);
  expect(activateDialogDefault(eventFor(action, root))).toBe(false);
  action.disabled = true;
  expect(activateDialogDefault(eventFor(root, root))).toBe(false);
  expect(click).not.toHaveBeenCalled();
});

test("Tab, composition and dialogs without explicit defaults do nothing", () => {
  const root = document.createElement("div");
  root.innerHTML = "<input />";
  expect(activateDialogDefault(eventFor(root, root, { key: "Tab" }))).toBe(false);
  expect(activateDialogDefault(eventFor(root, root, { isComposing: true }))).toBe(false);
  expect(activateDialogDefault(eventFor(root, root))).toBe(false);
});
