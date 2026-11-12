import { getPaymentConfirmation } from "./paymentConfirmation";

describe("getPaymentConfirmation", () => {
  test("shows cash tendered and change for an over-tendered sale", () => {
    expect(getPaymentConfirmation({
      total: 15, amount_paid: 20, change: 5,
      payments: [{ method: "Cash", amount: 20 }],
    })).toMatchObject({
      total: 15, amountPaid: 20, cashReceived: 20, otherPaid: 0,
      change: 5, hasCash: true, hasOther: false,
    });
  });

  test("shows zero change for exact cash", () => {
    expect(getPaymentConfirmation({
      total: 15, amount_paid: 15, change: 0,
      payments: [{ method: "Cash", amount: 15 }],
    }).change).toBe(0);
  });

  test("separates cash and non-cash split payments", () => {
    expect(getPaymentConfirmation({
      total: 25, amount_paid: 30, change: 5,
      payments: [{ method: "Cash", amount: 20 }, { method: "GCash", amount: 10 }],
    })).toMatchObject({
      amountPaid: 30, cashReceived: 20, otherPaid: 10,
      change: 5, hasCash: true, hasOther: true,
    });
  });

  test("identifies a non-cash-only payment", () => {
    expect(getPaymentConfirmation({
      total: 100, amount_paid: 100, change: 0,
      payments: [{ method: "GCash", amount: 100 }],
    })).toMatchObject({
      amountPaid: 100, cashReceived: 0, otherPaid: 100,
      change: 0, hasCash: false, hasOther: true,
    });
  });

  test("uses payment lines when an offline sale has no amount_paid field", () => {
    expect(getPaymentConfirmation({
      total: 15, change: 5, _offline: true,
      payments: [{ method: "Cash", amount: 20 }],
    })).toMatchObject({ amountPaid: 20, change: 5 });
  });

  test("rounds monetary values to cents without floating point residue", () => {
    expect(getPaymentConfirmation({
      total: 100.3,
      payments: [{ method: "Cash", amount: 100.1 }, { method: "Cash", amount: 0.2 }],
    })).toMatchObject({ amountPaid: 100.3, change: 0 });
  });
});
