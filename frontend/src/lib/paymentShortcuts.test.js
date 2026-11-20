import { validateTender } from "./paymentShortcuts";

test("cash exact and over-tender are valid", () => {
  expect(validateTender([{ method: "Cash", amount: "258.00" }], 258))
    .toEqual({ ok: true, paid: 258, change: 0 });
  expect(validateTender([{ method: "Cash", amount: "300.00" }], 258))
    .toEqual({ ok: true, paid: 300, change: 42 });
});

test("split payments may create change only from cash", () => {
  expect(validateTender([{ method: "GCash", amount: 200 }, { method: "Cash", amount: 100 }], 258))
    .toEqual({ ok: true, paid: 300, change: 42 });
  expect(validateTender([{ method: "GCash", amount: 300 }], 258))
    .toEqual({ ok: false, error: "Only cash payments can generate change" });
});

test("invalid or insufficient amounts cannot auto-complete", () => {
  expect(validateTender([{ method: "Cash", amount: "200" }], 258).ok).toBe(false);
  expect(validateTender([{ method: "Cash", amount: "abc" }], 258).ok).toBe(false);
  expect(validateTender([{ method: "Cash", amount: "-2" }], 258).ok).toBe(false);
  expect(validateTender([], 258).ok).toBe(false);
});
