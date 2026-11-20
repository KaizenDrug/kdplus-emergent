import { appendPinDigit, deletePinDigit, isCompletePin } from "./pinEntry";

test("PIN input accepts digits only and stops at exactly four", () => {
  let pin = "";
  for (const digit of ["1", "2", "3", "4", "5"]) pin = appendPinDigit(pin, digit);
  expect(pin).toBe("1234");
  expect(isCompletePin(pin)).toBe(true);
  expect(appendPinDigit("12", "x")).toBe("12");
});

test("PIN requires exactly four digits and supports Backspace", () => {
  expect(isCompletePin("123")).toBe(false);
  expect(isCompletePin("12345")).toBe(false);
  expect(isCompletePin("12a4")).toBe(false);
  expect(deletePinDigit("123")).toBe("12");
  expect(deletePinDigit("")).toBe("");
});
