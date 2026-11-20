import { shouldOpenChargeShortcut } from "./chargeShortcut";

const event = (extra = {}) => ({ key: "F9", ...extra });

test("F9 opens checkout only for a chargeable ticket", () => {
  expect(shouldOpenChargeShortcut(event(), { canCharge: true })).toBe(true);
  expect(shouldOpenChargeShortcut(event(), { canCharge: false })).toBe(false);
  expect(shouldOpenChargeShortcut(event(), { canCharge: true, blocked: true })).toBe(false);
});

test("F9 does not act on key repeat, modified keys, or IME composition", () => {
  for (const extra of [{ repeat: true }, { isComposing: true }, { altKey: true },
    { ctrlKey: true }, { metaKey: true }, { defaultPrevented: true }]) {
    expect(shouldOpenChargeShortcut(event(extra), { canCharge: true })).toBe(false);
  }
});

test("Other keys do not open checkout or interfere with scanning", () => {
  for (const key of ["Enter", "Tab", "F8", "1", "Escape"]) {
    expect(shouldOpenChargeShortcut(event({ key }), { canCharge: true })).toBe(false);
  }
});
